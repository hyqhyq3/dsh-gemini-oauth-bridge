// lib/index.js — host half of dsh-gemini-oauth-bridge.
//
// Bridges a Google AI subscription (Antigravity / Code Assist OAuth surface)
// into DSH as an OpenAI-compatible endpoint:
//
//   Settings UI  →  /gemini-oauth-bridge/api/{status,login,logout,refresh-models}
//   DSH provider →  /gemini-oauth-bridge/v1/{models,chat/completions}
//
// Everything upstream speaks the Antigravity Code Assist wire protocol
// (see lib/protocol.js). Tokens live in ~/.dsh/gemini-oauth-bridge.json —
// treat that file as a secret (written with mode 0600).

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  OAUTH,
  API,
  VERSION,
  buildAuthUrl,
  tokenExchangeForm,
  tokenRefreshForm,
  parseVersionManifest,
  userAgents,
  openaiToGeminiRequest,
  antigravityEnvelope,
  freshTranslateState,
  geminiToOpenaiFragments,
  assembleNonStreamResponse,
  extractSseEvents,
  unwrapStreamChunk,
  openaiCompletionId,
  resolveTier,
  parseAvailableModels,
  buildProviderYamlLines,
  mergeProviderYaml,
} from './protocol.js';

export const inject = ['webServer'];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const STATE_PATH = join(homedir(), '.dsh', 'gemini-oauth-bridge.json');
const SETTINGS_PATH = join(homedir(), '.dsh', 'settings.yaml');
const SETTINGS_BACKUP = join(homedir(), '.dsh', 'settings.yaml.bak-gemini-oauth-bridge');
const PROVIDER_NAME = 'gemini-oauth';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const VERSION_TTL_MS = 6 * 60 * 60 * 1000;
const TOKEN_SKEW_MS = 120 * 1000;
const SIGNATURE_CAP = 800;

// Placeholder list until a successful fetchAvailableModels refresh; the cache
// from the real endpoint replaces it after login.
const DEFAULT_MODELS = ['gemini-3.1-pro-high', 'gemini-3.7-flash-high', 'gemini-3.1-pro-low', 'gemini-3-flash'];

let state = loadState();
let loginFlow = null; // { state: string, server: http.Server, timer: Timeout }
let loginOrigin = null; // Host header of the /api/login request that started the flow
let refreshPromise = null; // single-flight token refresh
let versionInfo = { version: null, source: 'none', fetchedAt: 0 };
const cooldowns = new Map(); // model → unix ms until which requests are refused

function loadState() {
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    return {
      tokens: raw.tokens ?? null,
      email: raw.email ?? null,
      project: raw.project ?? null,
      tier: raw.tier ?? null,
      models: Array.isArray(raw.models) ? raw.models : null,
      modelCaps: raw.modelCaps && typeof raw.modelCaps === 'object' ? raw.modelCaps : null,
      providerSync: raw.providerSync === false ? false : true,
      providerSyncResult: raw.providerSyncResult && typeof raw.providerSyncResult === 'object' ? raw.providerSyncResult : null,
      antigravityVersion: typeof raw.antigravityVersion === 'string' ? raw.antigravityVersion : null,
      versionFetchedAt: Number(raw.versionFetchedAt) || 0,
      signatures: raw.signatures && typeof raw.signatures === 'object' ? raw.signatures : {},
      apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : null,
      apiConfig: raw.apiConfig && typeof raw.apiConfig === 'object' ? raw.apiConfig : {},
    };
  } catch {
    return { tokens: null, email: null, project: null, tier: null, models: null, modelCaps: null, providerSync: true, providerSyncResult: null, antigravityVersion: null, versionFetchedAt: 0, signatures: {}, apiKey: null, apiConfig: {} };
  }
}

function saveState() {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  const payload = {
    tokens: state.tokens,
    email: state.email,
    project: state.project,
    tier: state.tier,
    models: state.models,
    modelCaps: state.modelCaps,
    providerSync: state.providerSync,
    providerSyncResult: state.providerSyncResult,
    antigravityVersion: state.antigravityVersion,
    versionFetchedAt: state.versionFetchedAt,
    signatures: state.signatures,
    apiKey: state.apiKey,
    apiConfig: state.apiConfig,
  };
  writeFileSync(STATE_PATH, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

// Bounded store of thoughtSignatures keyed by tool-call id; replayed into
// request history so Gemini 3 multi-turn tool calls stay valid.
const signatureStore = new Map(Object.entries(state.signatures || {}));
function rememberSignature(id, signature) {
  if (!id || !signature) return;
  if (signatureStore.has(id)) signatureStore.delete(id);
  signatureStore.set(id, signature);
  while (signatureStore.size > SIGNATURE_CAP) {
    signatureStore.delete(signatureStore.keys().next().value);
  }
  state.signatures = Object.fromEntries(signatureStore);
  saveState();
}

function baseURLs() {
  const cfg = state.apiConfig || {};
  return {
    // CLIProxyAPI defaults generation to the daily channel; loadCodeAssist
    // stays on prod. Both overridable via state file `apiConfig`.
    generate: cfg.generateBase || API.dailyBase,
    load: cfg.loadBase || API.prodBase,
    onboard: cfg.onboardBase || API.dailyBase,
  };
}

// ---------------------------------------------------------------------------
// Upstream helpers
// ---------------------------------------------------------------------------

async function upstreamJson(url, { method = 'POST', token, ua, body, accept = '*/*', timeoutMs = 15000 }) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: accept,
    'User-Agent': ua,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, headers: res.headers, text, json };
}

function extractProject(data) {
  if (!data || typeof data !== 'object') return '';
  for (const key of ['cloudaicompanionProject', 'projectId', 'project']) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object' && typeof value.id === 'string' && value.id.trim()) return value.id.trim();
  }
  return '';
}

// ---------------------------------------------------------------------------
// Version tracking (anti-fingerprint drift): always claim the currently
// shipping desktop client version.
// ---------------------------------------------------------------------------

async function refreshVersion(force = false) {
  const now = Date.now();
  if (!force && state.antigravityVersion && now - state.versionFetchedAt < VERSION_TTL_MS) {
    versionInfo = { version: state.antigravityVersion, source: 'cache', fetchedAt: state.versionFetchedAt };
    return versionInfo;
  }
  try {
    const res = await fetch(VERSION.manifestUrl, {
      headers: { 'User-Agent': 'electron-builder', 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    const version = res.status === 200 ? parseVersionManifest(text) : null;
    if (version) {
      state.antigravityVersion = version;
      state.versionFetchedAt = now;
      saveState();
      versionInfo = { version, source: 'manifest', fetchedAt: now };
      return versionInfo;
    }
    throw new Error(`manifest returned ${res.status}`);
  } catch {
    if (state.antigravityVersion && now - state.versionFetchedAt < VERSION_TTL_MS * 4) {
      versionInfo = { version: state.antigravityVersion, source: 'cache', fetchedAt: state.versionFetchedAt };
    } else {
      versionInfo = { version: VERSION.fallback, source: 'fallback', fetchedAt: now };
    }
    return versionInfo;
  }
}

function currentVersion() {
  return versionInfo.version || state.antigravityVersion || VERSION.fallback;
}

// ---------------------------------------------------------------------------
// Token management (single-flight refresh)
// ---------------------------------------------------------------------------

function hasToken() {
  return !!(state.tokens && state.tokens.refresh_token);
}

async function refreshTokens() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const ua = userAgents(currentVersion());
      const res = await fetch(OAUTH.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Host: 'oauth2.googleapis.com',
          'User-Agent': ua.refresh,
        },
        body: tokenRefreshForm(state.tokens.refresh_token).toString(),
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      if (res.status === 400) {
        state.tokens = null;
        saveState();
        throw new Error(`refresh rejected (${res.status}): ${text.slice(0, 200)} — 请重新登录`);
      }
      if (!res.ok) throw new Error(`token refresh failed (${res.status}): ${text.slice(0, 200)}`);
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error('token refresh returned non-JSON response');
      }
      state.tokens = {
        access_token: json.access_token,
        refresh_token: json.refresh_token || state.tokens.refresh_token,
        expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
      };
      saveState();
      return state.tokens.access_token;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function ensureAccessToken() {
  if (!hasToken()) throw new Error('not logged in — 请先在 设置 → Gemini OAuth 中登录 Google 账号');
  if (state.tokens.access_token && Date.now() < (state.tokens.expiresAt ?? 0) - TOKEN_SKEW_MS) {
    return state.tokens.access_token;
  }
  return refreshTokens();
}

// ---------------------------------------------------------------------------
// Login + registration flow
// ---------------------------------------------------------------------------

async function fetchUserInfo(token) {
  const ua = userAgents(currentVersion());
  const res = await upstreamJson(OAUTH.userinfoEndpoint, { method: 'GET', token, ua: ua.short });
  if (res.status !== 200 || !res.json?.email) throw new Error(`userinfo failed (${res.status})`);
  return res.json.email;
}

async function loadCodeAssist(token) {
  const ua = userAgents(currentVersion());
  const res = await upstreamJson(`${baseURLs().load}${API.loadCodeAssistPath}`, {
    token,
    ua: ua.short,
    body: { metadata: { ideType: 'ANTIGRAVITY' } },
  });
  if (res.status !== 200) throw new Error(`loadCodeAssist failed (${res.status}): ${res.text.slice(0, 200)}`);
  return res.json || {};
}

async function onboardUser(token, tierId) {
  const ua = userAgents(currentVersion());
  const base = baseURLs().onboard;
  for (let attempt = 0; attempt < 12; attempt++) {
    const res = await upstreamJson(`${base}${API.onboardUserPath}`, {
      token,
      ua: ua.long,
      body: { tier_id: tierId, cloudaicompanionProject: '', metadata: { ideType: 'ANTIGRAVITY' } },
      timeoutMs: 20000,
    });
    if (res.status !== 200) throw new Error(`onboardUser failed (${res.status}): ${res.text.slice(0, 200)}`);
    const project = extractProject(res.json?.response) || extractProject(res.json);
    if (project) return project;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('onboardUser did not complete in time');
}

async function fetchAvailableModels(token) {
  const ua = userAgents(currentVersion());
  // The endpoint expects {"project": ...} (or {}) and lives on prod first;
  // daily mirrors it. The response's `models` is a map keyed by model id.
  const body = state.project ? { project: state.project } : {};
  for (const base of [API.prodBase, baseURLs().generate]) {
    const res = await upstreamJson(`${base}${API.fetchModelsPath}`, {
      token,
      ua: ua.short,
      body,
      timeoutMs: 20000,
    });
    if (res.status !== 200 || !res.json?.models) continue;
    const { ids, caps } = parseAvailableModels(res.json);
    if (!ids.length) continue;
    state.modelCaps = caps;
    return ids;
  }
  throw new Error('fetchAvailableModels returned no usable model list');
}

async function completeLogin(code) {
  // 1. exchange the authorization code
  const ua = userAgents(currentVersion());
  const exchangeRes = await fetch(OAUTH.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': ua.refresh,
    },
    body: tokenExchangeForm(code).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const exchangeText = await exchangeRes.text();
  if (!exchangeRes.ok) throw new Error(`token exchange failed (${exchangeRes.status}): ${exchangeText.slice(0, 200)}`);
  const tokens = JSON.parse(exchangeText);
  state.tokens = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
  };

  // 2. identity + registration
  try {
    state.email = await fetchUserInfo(tokens.access_token);
    const load = await loadCodeAssist(tokens.access_token);
    state.project = extractProject(load);
    // A paid subscription (paidTier, e.g. g1-pro-tier for Google AI Pro)
    // governs request entitlements even while currentTier still reads
    // free-tier — mirror the reference client's resolution order.
    state.tier = resolveTier(load);
    if (!state.project) {
      state.project = await onboardUser(tokens.access_token, state.tier);
    }
  } catch (error) {
    saveState(); // keep the tokens even when registration probing fails
    throw error;
  }

  // 3. best-effort model catalog refresh
  try {
    state.models = await fetchAvailableModels(tokens.access_token);
  } catch {}

  saveState();

  // 4. write the provider into ~/.dsh/settings.yaml (restart required to load)
  try {
    state.providerSyncResult = syncProvider(loginOrigin);
  } catch (error) {
    state.providerSyncResult = { ok: false, reason: String(error?.message ?? error) };
  }
  saveState();
}

function startLoginFlow(origin) {
  if (loginFlow) return { authUrl: buildAuthUrl(loginFlow.state), pending: true };
  const stateToken = randomBytes(16).toString('hex');
  loginOrigin = typeof origin === 'string' ? origin : null;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== OAUTH.callbackPath) {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const flowState = url.searchParams.get('state');
      const done = (ok, message) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px">` +
            `<h2>${ok ? '✅ 登录成功' : '❌ 登录失败'}</h2><p>${message}</p>` +
            `<p>可以关闭此页面，回到 DSH 设置页查看状态。</p></body>`,
        );
      };
      try {
        if (error) return done(false, `Google 返回：${error}`);
        if (!code || flowState !== stateToken) return done(false, '登录会话已过期或状态不匹配，请在 DSH 设置页重新发起登录');
        await completeLogin(code);
        return done(true, `账号 ${state.email ?? '?'} 已接入（项目 ${state.project ?? '?'}，tier ${state.tier ?? '?'}）`);
      } catch (error) {
        return done(false, String(error?.message ?? error));
      } finally {
        // Any completed callback — success, Google error, or stale state —
        // terminates the login flow; only unmatched paths leave it pending.
        stopLoginFlow();
      }
    } catch (error) {
      try {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(String(error?.message ?? error));
      } catch {}
    }
  });
  server.on('error', () => {
    // EADDRINUSE etc.: surface through status so the UI can explain.
    loginFlow = null;
  });
  loginFlow = { state: stateToken, server, timer: null };
  return new Promise((resolve) => {
    server.listen(OAUTH.callbackPort, '127.0.0.1', () => {
      loginFlow.timer = setTimeout(() => stopLoginFlow(), LOGIN_TIMEOUT_MS);
      resolve({ authUrl: buildAuthUrl(stateToken), pending: true });
    });
    server.once('error', (error) => {
      loginFlow = null;
      resolve({
        error:
          error?.code === 'EADDRINUSE'
            ? `端口 ${OAUTH.callbackPort} 被占用（Antigravity 可能正在登录）。关闭占用进程后重试。`
            : String(error?.message ?? error),
      });
    });
  });
}

function stopLoginFlow() {
  if (!loginFlow) return;
  if (loginFlow.timer) clearTimeout(loginFlow.timer);
  try {
    loginFlow.server.close();
  } catch {}
  loginFlow = null;
  loginOrigin = null;
}

async function logout() {
  stopLoginFlow();
  state.tokens = null;
  state.email = null;
  state.project = null;
  state.tier = null;
  saveState();
}

// ---------------------------------------------------------------------------
// Rate-limit cooldowns (429 handling)
// ---------------------------------------------------------------------------

function parseRetryDelay(text, headers) {
  if (headers) {
    const retryAfter = Number(headers.get('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  }
  const m = typeof text === 'string' ? text.match(/retryDelay["':\s]+(\d+)s/i) || text.match(/"retryDelay"\s*:\s*"(\d+)s"/) : null;
  if (m) return Number(m[1]) * 1000;
  return null;
}

function markCooldown(model, ms) {
  const until = Date.now() + Math.max(1000, Math.min(ms, 30 * 60 * 1000));
  cooldowns.set(model, until);
  return until;
}

// ---------------------------------------------------------------------------
// The OpenAI-compatible bridge
// ---------------------------------------------------------------------------

function openaiError(res, status, message, code) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message, type: status === 429 ? 'rate_limit_error' : 'api_error', code: code ?? null } }));
}

function checkApiKey(req) {
  if (!state.apiKey) return true;
  const auth = req.headers.authorization ?? '';
  return auth === `Bearer ${state.apiKey}`;
}

async function handleChat(req, res, body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) {
    return openaiError(res, 400, 'body.messages must be an array', 'invalid_request');
  }
  const model = typeof body.model === 'string' && body.model ? body.model : DEFAULT_MODELS[0];
  const cooldownUntil = cooldowns.get(model);
  if (cooldownUntil && Date.now() < cooldownUntil) {
    res.setHeader('Retry-After', Math.ceil((cooldownUntil - Date.now()) / 1000));
    return openaiError(res, 429, `model "${model}" is in quota cooldown until ${new Date(cooldownUntil).toISOString()}`, 'rate_limit');
  }
  // Clamp client max_tokens to the model's upstream max_completion_tokens.
  const cap = state.modelCaps?.[model]?.maxCompletionTokens;
  if (Number.isFinite(cap) && (!Number.isFinite(body.max_tokens) || body.max_tokens > cap)) {
    body = { ...body, max_tokens: cap };
  }

  const version = currentVersion();
  const ua = userAgents(version);
  const { request, sessionId } = openaiToGeminiRequest(body, { getSignature: (id) => signatureStore.get(id) });
  const envelope = antigravityEnvelope(model, state.project ?? '', request, sessionId);
  const stream = body.stream === true;
  const base = baseURLs().generate;
  const url = `${base}${stream ? API.streamPath + '?alt=sse' : API.generatePath}`;

  const controller = new AbortController();
  let clientGone = false;
  req.on('close', () => {
    if (!res.writableEnded) {
      clientGone = true;
      controller.abort();
    }
  });

  let attempt = 0;
  for (;;) {
    attempt += 1;
    let token;
    try {
      token = await ensureAccessToken();
    } catch (error) {
      return openaiError(res, 401, String(error?.message ?? error), 'not_logged_in');
    }

    let upstream;
    try {
      upstream = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'User-Agent': ua.short,
        },
        body: JSON.stringify(envelope),
        signal: controller.signal,
      });
    } catch (error) {
      if (clientGone || controller.signal.aborted) return; // client aborted: nothing to write
      return openaiError(res, 502, `upstream fetch failed: ${String(error?.message ?? error)}`, 'upstream');
    }

    if (upstream.status === 401 && attempt === 1) {
      try {
        await refreshTokens();
        continue; // retry once with the fresh token
      } catch (error) {
        return openaiError(res, 401, String(error?.message ?? error), 'not_logged_in');
      }
    }

    if (upstream.status === 429) {
      const text = await upstream.text().catch(() => '');
      const delay = parseRetryDelay(text, upstream.headers) ?? 10 * 60 * 1000;
      const until = markCooldown(model, delay);
      res.setHeader('Retry-After', Math.ceil((until - Date.now()) / 1000));
      return openaiError(res, 429, `Google quota limited for "${model}": ${text.slice(0, 300)}`, 'rate_limit');
    }

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      const status = upstream.status >= 500 ? 502 : upstream.status;
      return openaiError(res, status, `upstream ${upstream.status}: ${text.slice(0, 500)}`, 'upstream');
    }

    if (!stream) return pipeNonStream(res, upstream, model, sessionId);
    return pipeStream(req, res, upstream, model, sessionId);
  }
}

async function pipeNonStream(res, upstream, model, sessionId) {
  const text = await upstream.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  const gem = unwrapStreamChunk(data);
  const translateState = freshTranslateState({ stream: false, idSeed: sessionId });
  if (gem) geminiToOpenaiFragments(gem, translateState);
  for (const [id, signature] of translateState.signaturesById) rememberSignature(id, signature);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(assembleNonStreamResponse(translateState, model)));
}

async function pipeStream(req, res, upstream, model, sessionId) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const completionId = openaiCompletionId();
  const created = Math.floor(Date.now() / 1000);
  const translateState = freshTranslateState({ stream: true, idSeed: sessionId });
  let first = true;

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  let sentFinish = false;
  const sendDelta = (fragment) => {
    const delta = { ...(first ? { role: 'assistant' } : {}), ...fragment.delta };
    first = false;
    if (fragment.finish_reason) sentFinish = true;
    const chunk = {
      id: completionId,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: fragment.finish_reason ?? null }],
    };
    if (fragment.usage) chunk.usage = fragment.usage;
    send(chunk);
  };

  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for await (const chunk of upstream.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const { events, rest } = extractSseEvents(buffer);
      buffer = rest;
      for (const event of events) {
        if (!event || event === '[DONE]') continue;
        let obj;
        try {
          obj = JSON.parse(event);
        } catch {
          continue;
        }
        const gem = unwrapStreamChunk(obj);
        if (!gem) continue;
        for (const fragment of geminiToOpenaiFragments(gem, translateState)) sendDelta(fragment);
      }
    }
  } catch (error) {
    console.error('[gemini-oauth-bridge] stream error:', String(error?.message ?? error));
    try {
      if (!res.writableEnded) {
        if (!sentFinish) {
          sendDelta({ delta: {}, finish_reason: 'stop' });
        }
        res.write('data: [DONE]\n\n');
        res.end();
      }
    } catch {} // client already gone: the socket is dead, nothing to flush
    return;
  }
  for (const [id, signature] of translateState.signaturesById) rememberSignature(id, signature);
  if (!res.writableEnded) {
    if (!sentFinish) {
      // Upstream never delivered a finishReason — still terminate the SSE stream.
      sendDelta({ delta: {}, finish_reason: 'stop', usage: translateState.usage });
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function json(res, code, value) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

// Write (or refresh) llm-pi-ai.providers.gemini-oauth in ~/.dsh/settings.yaml.
// Surgical merge: every other byte of the user's config is preserved; a
// one-time backup is kept before the first modification. Returns a result
// object surfaced through the API and the settings page.
function syncProvider(origin) {
  if (state.providerSync === false) return { ok: false, skipped: true, reason: 'providerSync disabled in state file' };
  const ids = (state.models ?? []).filter((id) => typeof id === 'string' && id && !/^(chat_|tab_)/.test(id));
  if (!ids.length) return { ok: false, reason: 'no model list yet — 刷新模型列表后再试' };
  let host = '127.0.0.1:3080';
  if (typeof origin === 'string') {
    const h = origin.replace(/^https?:\/\//, '').split('/')[0];
    if (/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h)) host = h;
  }
  const lines = buildProviderYamlLines(host, ids);
  let text = '';
  try {
    text = readFileSync(SETTINGS_PATH, 'utf8');
  } catch {}
  const firstWrite = !text; // no existing file
  const merged = mergeProviderYaml(text || '', PROVIDER_NAME, lines);
  if (!merged.ok) return { ok: false, reason: merged.reason };
  if (!firstWrite && !existsSync(SETTINGS_BACKUP)) {
    try {
      writeFileSync(SETTINGS_BACKUP, text, 'utf8');
    } catch {}
  }
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  const tmp = SETTINGS_PATH + '.tmp';
  writeFileSync(tmp, merged.text, 'utf8');
  renameSync(tmp, SETTINGS_PATH);
  state.providerSyncResult = { at: Date.now(), models: ids.length, host };
  saveState();
  return { ok: true, models: ids.length, host, backup: !firstWrite && existsSync(SETTINGS_BACKUP) };
}

function statusPayload() {
  return {
    ok: true,
    loggedIn: hasToken(),
    email: state.email,
    project: state.project,
    tier: state.tier,
    models: state.models ?? DEFAULT_MODELS,
    modelSource: state.models ? 'upstream' : 'default',
    version: currentVersion(),
    versionSource: versionInfo.source,
    loginPending: !!loginFlow,
    providerSync: state.providerSyncResult,
    tokenExpiresAt: state.tokens?.expiresAt ?? null,
    signatureCount: signatureStore.size,
    cooldowns: Object.fromEntries([...cooldowns.entries()].filter(([, until]) => until > Date.now())),
    apiConfig: state.apiConfig ?? {},
  };
}

export function apply(ctx) {
  void refreshVersion();

  const route = ctx.webServer.register({
    kind: 'prefix',
    path: '/gemini-oauth-bridge',
    async handler(req, res) {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      try {
        // --- Settings UI API ---
        if (path === '/gemini-oauth-bridge/api/ping' && req.method === 'GET') {
          return json(res, 200, { ok: true, version: 1 });
        }
        if (path === '/gemini-oauth-bridge/api/status' && req.method === 'GET') {
          return json(res, 200, statusPayload());
        }
        if (path === '/gemini-oauth-bridge/api/login' && req.method === 'POST') {
          const result = await startLoginFlow(req.headers.host ? `http://${req.headers.host}` : null);
          return json(res, result.error ? 503 : 200, result);
        }
        if (path === '/gemini-oauth-bridge/api/logout' && req.method === 'POST') {
          await logout();
          return json(res, 200, { ok: true });
        }
        if (path === '/gemini-oauth-bridge/api/refresh-models' && req.method === 'POST') {
          if (!hasToken()) return json(res, 400, { error: 'not logged in' });
          try {
            const token = await ensureAccessToken();
            state.models = await fetchAvailableModels(token);
            saveState();
          } catch (error) {
            return json(res, 502, { error: String(error?.message ?? error) });
          }
          let provider;
          try {
            provider = syncProvider(req.headers.host ? `http://${req.headers.host}` : null);
          } catch (error) {
            provider = { ok: false, reason: String(error?.message ?? error) };
          }
          state.providerSyncResult = provider;
          saveState();
          return json(res, 200, { ok: true, models: state.models, provider });
        }
        if (path === '/gemini-oauth-bridge/api/refresh-version' && req.method === 'POST') {
          const info = await refreshVersion(true);
          return json(res, 200, info);
        }

        // --- OpenAI-compatible bridge (consumed by DSH providers) ---
        if (!checkApiKey(req)) return openaiError(res, 401, 'invalid bridge API key', 'unauthorized');
        if (path === '/gemini-oauth-bridge/v1/models' && req.method === 'GET') {
          const models = state.models ?? DEFAULT_MODELS;
          const created = Math.floor(Date.now() / 1000);
          return json(res, 200, {
            object: 'list',
            data: models.map((id) => ({ id, object: 'model', created, owned_by: 'google' })),
          });
        }
        if (path === '/gemini-oauth-bridge/v1/chat/completions' && req.method === 'POST') {
          const body = await readBody(req);
          return await handleChat(req, res, body);
        }

        // --- Root: tiny human-readable summary ---
        if (path === '/gemini-oauth-bridge' || path === '/gemini-oauth-bridge/') {
          const st = statusPayload();
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(
            `<!doctype html><meta charset="utf-8"><title>gemini-oauth-bridge</title>` +
              `<body style="font-family:system-ui;padding:40px"><h2>dsh-gemini-oauth-bridge</h2><ul>` +
              `<li>登录：${st.loggedIn ? `✅ ${st.email}` : '未登录'}</li>` +
              `<li>项目：${st.project ?? '-'}（tier ${st.tier ?? '-'}）</li>` +
              `<li>客户端版本伪装：${st.version}（${st.versionSource}）</li>` +
              `<li>模型：${st.models.join(', ')}（${st.modelSource}）</li>` +
              `</ul><p>OpenAI 兼容端点：<code>/gemini-oauth-bridge/v1</code></p></body>`,
          );
        }

        res.writeHead(404);
        res.end();
      } catch (error) {
        try {
          json(res, 500, { error: String(error?.message ?? error) });
        } catch {}
      }
    },
  });

  ctx.effect(() => {
    stopLoginFlow();
    return route;
  });
}
