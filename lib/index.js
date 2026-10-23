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
  isTrustedAuthority,
  buildProviderYamlLines,
  mergeProviderYaml,
  mergeCredentialYaml,
  PROVIDER_API_KEY_ENV,
  PROVIDER_PLACEHOLDER_KEY,
} from './protocol.js';

export const inject = ['webServer'];

const zh = {
  "source_none": "无",
  "source_cache": "缓存",
  "source_manifest": "版本清单",
  "source_fallback": "兜底",
  "source_upstream": "上游",
  "source_default": "默认",
  "notLoggedIn": "not logged in — 请先在 设置 → Gemini OAuth 中登录 Google 账号",
  "noModels": "no model list yet — 刷新模型列表后再试",
  "disabled": "状态文件中已禁用 providerSync",
  "portBusy": "端口 {port} 被占用（Antigravity 可能正在登录）。关闭占用进程后重试。",
  "loginSuccess": "✅ 登录成功",
  "loginFailure": "❌ 登录失败",
  "closePage": "可以关闭此页面，回到 DSH 设置页查看状态。",
  "googleError": "Google 返回：{error}",
  "expired": "登录会话已过期或状态不匹配，请在 DSH 设置页重新发起登录",
  "accountSummary": "账号 {email} 已接入（项目 {project}，tier {tier}）",
  "login": "登录：{value}",
  "loggedOut": "未登录",
  "project": "项目：{project}（tier {tier}）",
  "version": "客户端版本伪装：{version}（{source}）",
  "models": "模型：{models}（{source}）",
  "endpoint": "OpenAI 兼容端点：",
  "providerMerge": "llm-pi-ai 使用了行内值，无法合并",
  "credentialMerge": "凭据文件不是 version-1 文档，请通过模型页面添加 key",
  "refreshRejected": "refresh rejected ({status}): {text} — 请重新登录",
  "refreshFailed": "token 刷新失败（{status}）：{text}",
  "refreshJson": "token 刷新返回了非 JSON 响应",
  "userinfo": "账号信息获取失败（{status}）",
  "loadFailed": "loadCodeAssist 失败（{status}）：{text}",
  "onboardFailed": "onboardUser 失败（{status}）：{text}",
  "onboardTimeout": "onboardUser 未能及时完成",
  "modelsFailed": "fetchAvailableModels 未返回可用的模型列表",
  "modelUnavailableListed": "模型 \"{model}\" 在当前账号不可用（{reason}）。它仍在当前模型列表中，可能是账号权益或模型下架所致，请点击「刷新模型列表」同步。",
  "modelUnavailableGone": "模型 \"{model}\" 在当前账号不可用（{reason}）。它已不在当前账号的模型列表中，请点击「刷新模型列表」同步后再选。",
  "reasonUnknown": "上游未提供原因",
  "syncBothFailed": "热更新失败（{hot}）；settings.yaml 写入也失败（{legacy}）",
  "exchangeFailed": "token 交换失败（{status}）：{text}"
};
const en = {
  "source_none": "None",
  "source_cache": "Cache",
  "source_manifest": "Manifest",
  "source_fallback": "Fallback",
  "source_upstream": "Upstream",
  "source_default": "Default",
  "notLoggedIn": "Not signed in — sign in with Google in Settings → Gemini OAuth first",
  "noModels": "No model list yet — refresh the model list and retry",
  "disabled": "providerSync disabled in state file",
  "portBusy": "Port {port} is in use (Antigravity may be signing in). Close the process using it and retry.",
  "loginSuccess": "✅ Sign-in successful",
  "loginFailure": "❌ Sign-in failed",
  "closePage": "You can close this page and return to DSH Settings to check the status.",
  "googleError": "Google returned: {error}",
  "expired": "The sign-in session expired or its state does not match. Start sign-in again in DSH Settings.",
  "accountSummary": "Account {email} connected (project {project}, tier {tier})",
  "login": "Sign-in: {value}",
  "loggedOut": "Not signed in",
  "project": "Project: {project} (tier {tier})",
  "version": "Client version impersonation: {version} ({source})",
  "models": "Models: {models} ({source})",
  "endpoint": "OpenAI-compatible endpoint: ",
  "providerMerge": "llm-pi-ai uses an inline value; merge refused",
  "credentialMerge": "credentials file is not a version-1 document; add the key through the Models page",
  "refreshRejected": "Refresh rejected ({status}): {text} — sign in again",
  "refreshFailed": "Token refresh failed ({status}): {text}",
  "refreshJson": "Token refresh returned a non-JSON response",
  "userinfo": "User info failed ({status})",
  "loadFailed": "loadCodeAssist failed ({status}): {text}",
  "onboardFailed": "onboardUser failed ({status}): {text}",
  "onboardTimeout": "onboardUser did not complete in time",
  "modelsFailed": "fetchAvailableModels returned no usable model list",
  "modelUnavailableListed": "Model \"{model}\" is unavailable on this account ({reason}). It is still in the current model list — this is usually an entitlement or a retired model; click Refresh model list to sync.",
  "modelUnavailableGone": "Model \"{model}\" is unavailable on this account ({reason}). It is no longer in this account's model list; click Refresh model list and pick again.",
  "reasonUnknown": "no reason given by upstream",
  "syncBothFailed": "live update failed ({hot}); writing settings.yaml also failed ({legacy})",
  "exchangeFailed": "Token exchange failed ({status}): {text}"
};

function message(key, params = {}) { return { key, params }; }
function renderMessage(value, lang = 'zh') {
  if (!value || typeof value !== 'object') return value;
  return ((lang === 'en' ? en : zh)[value.key] ?? value.key)
    .replace(/\{(\w+)\}/g, (match, name) => String(value.params?.[name] ?? match));
}
function localizedError(text, descriptor) {
  return Object.assign(new Error(text), { localized: descriptor });
}
function errorMessage(error) { return error?.localized ?? String(error?.message ?? error); }
// Render only owned message fields; upstream strings and model data remain intact.
function renderPayload(value, lang) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => renderPayload(item, lang));
  return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, key === 'error' || key === 'reason' ? renderMessage(item, lang) : renderPayload(item, lang)]));
}
function resolveLang(req) {
  try {
    const lang = new URL(req.url ?? '/', 'http://localhost').searchParams.get('lang');
    if (lang === 'zh' || lang === 'en') return lang;
  } catch {}
  try {
    const text = readFileSync(join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'settings.yaml'), 'utf8');
    let inLocale = false;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim() || /^\s*#/.test(line)) continue;
      if (/^locale:\s*(?:#.*)?$/.test(line)) { inLocale = true; continue; }
      if (/^\S/.test(line)) inLocale = false;
      if (!inLocale) continue;
      const match = line.match(/^ +preference:\s*(?:"(zh|en)"|'(zh|en)'|(zh|en))\s*(?:#.*)?$/);
      if (match) return match[1] || match[2] || match[3];
    }
  } catch {}
  return 'zh';
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function callbackPage(ok, value, lang) {
  const t = (key) => escapeHtml(renderMessage(message(key), lang));
  return `<!doctype html><html lang="${lang}"><meta charset="utf-8"><body style="font-family:system-ui;padding:40px">` +
    `<h2>${t(ok ? 'loginSuccess' : 'loginFailure')}</h2><p>${escapeHtml(renderMessage(value, lang))}</p>` +
    `<p>${t('closePage')}</p></body></html>`;
}


// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const STATE_PATH = join(homedir(), '.dsh', 'gemini-oauth-bridge.json');
const SETTINGS_PATH = join(homedir(), '.dsh', 'settings.yaml');
const SETTINGS_BACKUP = join(homedir(), '.dsh', 'settings.yaml.bak-gemini-oauth-bridge');
const CREDENTIALS_PATH = join(homedir(), '.dsh', '.credentials.yaml');
const PROVIDER_NAME = 'gemini-oauth';
// Loader entry id of the pi-ai LLM adapter. Its `providers` config field is
// declared `.volatile()`, so writing it through the settings service hot-applies
// the new model list (dsh-llm-pi-ai re-registers routes in place) and persists
// the profile patch — no DSH restart needed. Same path the DSH Models page uses.
const LLM_PI_AI_ENTRY = 'llm-pi-ai';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const VERSION_TTL_MS = 6 * 60 * 60 * 1000;
const TOKEN_SKEW_MS = 120 * 1000;
const SIGNATURE_CAP = 800;

// Placeholder list until a successful fetchAvailableModels refresh; the cache
// from the real endpoint replaces it after login.
const DEFAULT_MODELS = ['gemini-3.1-pro-high', 'gemini-3.7-flash-high', 'gemini-3.1-pro-low', 'gemini-3-flash'];

// Upstream's catalog mixes real models with internal routing ids
// (`chat_20706`, `tab_flash_lite_preview`). They cannot be used as chat models —
// upstream answers 400 INVALID_ARGUMENT — so they are kept out of both the
// provider document and /v1/models. `state.models` does keep them, because it is
// a faithful mirror of what the account can see.
function isPublishableModelId(id) {
  return typeof id === 'string' && !!id && !/^(chat_|tab_)/.test(id);
}

let state = loadState();
let loginFlow = null; // { state: string, server: http.Server, timer: Timeout }
let loginOrigin = null; // Host header of the /api/login request that started the flow
let refreshPromise = null; // single-flight token refresh
let pluginCtx = null; // cordis ctx captured in apply(); lazy ctx.get('settings')
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
      modelsUnavailable: raw.modelsUnavailable && typeof raw.modelsUnavailable === 'object' ? raw.modelsUnavailable : null,
      trustedHosts: Array.isArray(raw.trustedHosts) ? raw.trustedHosts : [],
      providerSync: raw.providerSync === false ? false : true,
      providerSyncResult: raw.providerSyncResult && typeof raw.providerSyncResult === 'object' ? raw.providerSyncResult : null,
      antigravityVersion: typeof raw.antigravityVersion === 'string' ? raw.antigravityVersion : null,
      versionFetchedAt: Number(raw.versionFetchedAt) || 0,
      signatures: raw.signatures && typeof raw.signatures === 'object' ? raw.signatures : {},
      apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : null,
      apiConfig: raw.apiConfig && typeof raw.apiConfig === 'object' ? raw.apiConfig : {},
    };
  } catch {
    return { tokens: null, email: null, project: null, tier: null, models: null, modelCaps: null, modelsUnavailable: null, trustedHosts: [], providerSync: true, providerSyncResult: null, antigravityVersion: null, versionFetchedAt: 0, signatures: {}, apiKey: null, apiConfig: {} };
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
    modelsUnavailable: state.modelsUnavailable,
    trustedHosts: state.trustedHosts,
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
        throw localizedError(`refresh rejected (${res.status}): ${text.slice(0, 200)}`, message('refreshRejected', { status: res.status, text: text.slice(0, 200) }));
      }
      if (!res.ok) throw localizedError(`token refresh failed (${res.status}): ${text.slice(0, 200)}`, message('refreshFailed', { status: res.status, text: text.slice(0, 200) }));
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw localizedError('token refresh returned non-JSON response', message('refreshJson', {}));
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
  if (!hasToken()) throw localizedError('not logged in', message('notLoggedIn'));
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
  if (res.status !== 200 || !res.json?.email) throw localizedError(`userinfo failed (${res.status})`, message('userinfo', { status: res.status }));
  return res.json.email;
}

async function loadCodeAssist(token) {
  const ua = userAgents(currentVersion());
  const res = await upstreamJson(`${baseURLs().load}${API.loadCodeAssistPath}`, {
    token,
    ua: ua.short,
    body: { metadata: { ideType: 'ANTIGRAVITY' } },
  });
  if (res.status !== 200) throw localizedError(`loadCodeAssist failed (${res.status}): ${res.text.slice(0, 200)}`, message('loadFailed', { status: res.status, text: res.text.slice(0, 200) }));
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
    if (res.status !== 200) throw localizedError(`onboardUser failed (${res.status}): ${res.text.slice(0, 200)}`, message('onboardFailed', { status: res.status, text: res.text.slice(0, 200) }));
    const project = extractProject(res.json?.response) || extractProject(res.json);
    if (project) return project;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw localizedError('onboardUser did not complete in time', message('onboardTimeout', {}));
}

async function fetchAvailableModels(token) {
  const ua = userAgents(currentVersion());
  // The endpoint expects {"project": ...} (or {}) and lives on prod first;
  // daily mirrors it. The response's `models` is a map keyed by model id.
  const body = state.project ? { project: state.project } : {};
  for (const base of [API.prodBase, baseURLs().generate]) {
    let res;
    try {
      res = await upstreamJson(`${base}${API.fetchModelsPath}`, {
        token,
        ua: ua.short,
        body,
        timeoutMs: 20000,
      });
    } catch {
      continue; // network-level failure on this base — try the next one
    }
    if (res.status !== 200 || !res.json?.models) continue;
    const { ids, caps, unavailable } = parseAvailableModels(res.json);
    if (!ids.length) continue;
    state.modelCaps = caps;
    // Ids the account may not use (upstream `disabled: true`) are kept out of
    // the published list but remembered, so a request for one of them can be
    // answered with the upstream's own reason instead of an opaque 404.
    state.modelsUnavailable = Object.keys(unavailable).length ? unavailable : null;
    return ids;
  }
  throw localizedError('fetchAvailableModels returned no usable model list', message('modelsFailed', {}));
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
  if (!exchangeRes.ok) throw localizedError(`token exchange failed (${exchangeRes.status}): ${exchangeText.slice(0, 200)}`, message('exchangeFailed', { status: exchangeRes.status, text: exchangeText.slice(0, 200) }));
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

  // 4. write the provider into the DSH llm-pi-ai config (hot-applied at
  //    runtime when the settings service is available)
  try {
    state.providerSyncResult = await syncProvider(loginOrigin);
  } catch (error) {
    state.providerSyncResult = { ok: false, reason: errorMessage(error) };
  }
  saveState();
}

function startLoginFlow(origin, lang) {
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
        res.end(callbackPage(ok, message, loginFlow?.lang ?? resolveLang(req)));
      };
      try {
        if (error) return done(false, message('googleError', { error }));
        if (!code || flowState !== stateToken) return done(false, message('expired'));
        await completeLogin(code);
        return done(true, message('accountSummary', { email: state.email ?? '?', project: state.project ?? '?', tier: state.tier ?? '?' }));
      } catch (error) {
        return done(false, errorMessage(error));
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
  loginFlow = { state: stateToken, server, lang, timer: null };
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
            ? message('portBusy', { port: OAUTH.callbackPort })
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

async function handleChat(req, res, body, lang) {
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
  // `req` has already been fully consumed by readBody() before this handler
  // runs, so its 'close' event fires immediately and can never signal a
  // disconnect — the upstream request would then outlive a cancelled
  // generation, burning quota until it finishes. `res` is the truthful signal:
  // it closes early when the client socket goes away, and normally once the
  // response has been written (in which case writableEnded is set and we leave
  // the already-completed upstream alone).
  const onClientGone = () => {
    if (!res.writableEnded) {
      clientGone = true;
      controller.abort();
    }
  };
  res.on('close', onClientGone);

  let attempt = 0;
  for (;;) {
    attempt += 1;
    let token;
    try {
      token = await ensureAccessToken();
    } catch (error) {
      return openaiError(res, 401, renderMessage(errorMessage(error), lang), 'not_logged_in');
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
        return openaiError(res, 401, renderMessage(errorMessage(error), lang), 'not_logged_in');
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
      // A 404 NOT_FOUND means the model id reached Google but is not provisioned
      // for this account — typically a model the catalog marks `disabled`, or an
      // id that has since disappeared upstream while still sitting in a stale
      // provider list. Surface that instead of Google's opaque body.
      //
      // The match requires the *structured* error envelope: a plain HTML or
      // text 404 page ("Error 404 (Not Found)!!") comes from a wrong base URL or
      // path and must keep falling through to the generic transport error below.
      let notFound = false;
      if (upstream.status === 404) {
        try {
          const error = JSON.parse(text)?.error;
          notFound = error?.status === 'NOT_FOUND'
            || (typeof error?.message === 'string' && /not found/i.test(error.message));
        } catch {}
      }
      if (notFound) {
        const reason = state.modelsUnavailable?.[model] ?? renderMessage(message('reasonUnknown'), lang);
        const known = Array.isArray(state.models) && state.models.includes(model);
        const key = known ? 'modelUnavailableListed' : 'modelUnavailableGone';
        return openaiError(res, 404, renderMessage(message(key, { model, reason }), lang), 'model_not_found');
      }
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
  // Every failure below used to fall through to a 200 with content:null and
  // finish_reason:"stop", which DSH renders as a deliberate empty answer — the
  // user sees silence instead of a diagnosable error. A non-JSON body means the
  // base URL or path answered with something that is not a completion.
  if (data === null) return openaiError(res, 502, 'upstream returned a non-JSON body', 'upstream');
  const gem = unwrapStreamChunk(data);
  if (gem && gem.error) {
    const code = Number(gem.error.code);
    const status = Number.isFinite(code) && code >= 400 && code < 500 ? code : 502;
    return openaiError(res, status, `upstream error: ${String(gem.error.message ?? 'unknown error')}`, 'upstream');
  }
  const translateState = freshTranslateState({ stream: false, idSeed: sessionId });
  if (gem) geminiToOpenaiFragments(gem, translateState);
  for (const [id, signature] of translateState.signaturesById) rememberSignature(id, signature);
  const payload = assembleNonStreamResponse(translateState, model);
  // A prompt the model refused to answer carries no candidates at all; saying
  // "stop" would make a safety refusal look like an intentional blank reply.
  if (gem?.promptFeedback?.blockReason) {
    payload.choices[0].finish_reason = 'content_filter';
  } else if (!Array.isArray(gem?.candidates)) {
    // Not a completion at all: a bare `{}`, or a success status wrapping an
    // empty envelope. A real answer always carries a `candidates` array, so
    // anything else is an upstream failure rather than a blank reply.
    return openaiError(res, 502, 'upstream response contained no candidates', 'upstream');
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
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
    // A cancelled generation aborts the upstream fetch on purpose; that is a
    // normal outcome, not an error worth logging on every Esc keypress.
    if (!clientGone && error?.name !== 'AbortError') {
      console.error('[gemini-oauth-bridge] stream error:', String(error?.message ?? error));
    }
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

// DSH refuses a provider profile with no credential reference, so the provider
// block names PROVIDER_API_KEY_ENV and this provisions the matching entry in
// $DSH_HOME/.credentials.yaml. The bridge accepts any bearer token, so a fixed
// placeholder is enough; an existing entry (the user's own key) is never
// overwritten. The file is created 0600 because dsh-credentials-local refuses
// to boot on a document readable beyond its owner.
function ensureCredential() {
  let text = '';
  try {
    text = readFileSync(CREDENTIALS_PATH, 'utf8');
  } catch {}
  const merged = mergeCredentialYaml(text, PROVIDER_API_KEY_ENV, PROVIDER_PLACEHOLDER_KEY);
  if (!merged.ok) return { ok: false, reason: message('credentialMerge') };
  if (!merged.created) return { ok: true, created: false };
  try {
    mkdirSync(dirname(CREDENTIALS_PATH), { recursive: true });
    const tmp = CREDENTIALS_PATH + '.tmp';
    writeFileSync(tmp, merged.text, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, CREDENTIALS_PATH);
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }
  return { ok: true, created: true };
}

// Write (or refresh) llm-pi-ai.providers.gemini-oauth.
//
// Preferred path: the settings service (`ctx.get('settings')`), which is how
// the DSH Models page edits provider config. `settings.update` deep-merges into
// the llm-pi-ai entry, so only the gemini-oauth route changes; the edit is
// validated by the adapter's own schema, hot-applied through the loader (the
// volatile providers dict re-registers routes immediately — no restart), and
// persisted into the active profile's cordis.patch.yml.
//
// Fallback path: the legacy boot-only ~/.dsh/settings.yaml document. On DSH
// ≥ 0.2 it is only imported at boot (then renamed), so a write there needs a
// restart; it is still maintained on every sync so older deployments keep
// working and the next boot's legacy import stays consistent with runtime.
// Surgical merge: every other byte of the user's config is preserved; a
// one-time backup is kept before the first modification. Returns a result
// object surfaced through the API and the settings page.
//
// The hot path is authoritative when it succeeds; the legacy document is still
// reconciled on every sync, so an older DSH — or a boot on a build where the
// settings service is absent — still finds a correct provider block.
async function syncProvider(origin) {
  if (state.providerSync === false) return { ok: false, skipped: true, reason: message('disabled') };
  const ids = (state.models ?? []).filter(isPublishableModelId);
  if (!ids.length) return { ok: false, reason: message('noModels') };
  let host = '127.0.0.1:3080';
  if (typeof origin === 'string') {
    const h = origin.replace(/^https?:\/\//, '').split('/')[0];
    if (/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h)) host = h;
  }
  const profile = {
    api: 'openai-completions',
    baseURL: `http://${host}/gemini-oauth-bridge/v1`,
    apiKeyEnv: PROVIDER_API_KEY_ENV,
    models: ids.map((id) => ({ id })),
  };

  // --- hot path: settings service, effective immediately ---
  const settings = pluginCtx && typeof pluginCtx.get === 'function' ? pluginCtx.get('settings') : null;
  let hot = null;
  if (settings && typeof settings.update === 'function') {
    const credential = ensureCredential();
    try {
      await settings.update(LLM_PI_AI_ENTRY, { providers: { [PROVIDER_NAME]: profile } });
      hot = { ok: true, hotReload: true, models: ids.length, host, apiKeyEnv: PROVIDER_API_KEY_ENV, credential };
    } catch (error) {
      hot = { ok: false, reason: String(error?.message ?? error) };
    }
  }

  // --- legacy document write (boot-only on DSH ≥ 0.2) ---
  // Skipped when the hot path already succeeded. On DSH ≥ 0.2 this document is
  // boot-only, and recreating it has a real cost: `importLegacyDocument`
  // renames it over `settings.yaml.imported` on the next boot, so writing it
  // clobbers the archived pre-migration document for no runtime benefit.
  let legacy = { ok: true, skipped: true };
  let firstWrite = false;
  if (!(hot && hot.ok)) {
    const lines = buildProviderYamlLines(host, ids);
    let text = '';
    try {
      text = readFileSync(SETTINGS_PATH, 'utf8');
    } catch {}
    firstWrite = !text; // no existing file
    const merged = mergeProviderYaml(text || '', PROVIDER_NAME, lines);
    legacy = merged.ok
      ? writeSettingsDocument(merged.text, firstWrite, text)
      : { ok: false, reason: message('providerMerge') };
  }

  if (hot && hot.ok) {
    state.providerSyncResult = { at: Date.now(), models: ids.length, host, hotReload: true, apiKeyEnv: PROVIDER_API_KEY_ENV, credential: hot.credential };
    saveState();
    return hot;
  }

  if (!legacy.ok) return { ok: false, reason: hot ? message('syncBothFailed', { hot: hot.reason, legacy: legacy.reason }) : legacy.reason };
  const credential = ensureCredential();
  state.providerSyncResult = { at: Date.now(), models: ids.length, host, credential };
  saveState();
  return {
    ok: true,
    models: ids.length,
    host,
    apiKeyEnv: PROVIDER_API_KEY_ENV,
    credential,
    backup: !firstWrite && existsSync(SETTINGS_BACKUP),
  };
}

function writeSettingsDocument(nextText, firstWrite, previousText) {
  try {
    if (!firstWrite && !existsSync(SETTINGS_BACKUP)) {
      try {
        writeFileSync(SETTINGS_BACKUP, previousText, 'utf8');
      } catch {}
    }
    mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
    const tmp = SETTINGS_PATH + '.tmp';
    writeFileSync(tmp, nextText, 'utf8');
    renameSync(tmp, SETTINGS_PATH);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) };
  }
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
    unavailableModels: state.modelsUnavailable ?? null,
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

// ---------------------------------------------------------------------------
// Browser-trust fence
// ---------------------------------------------------------------------------
//
// DSH fences its own `/api/*` surface against DNS rebinding and cross-site
// requests, but a plugin `webServer.register({kind:'prefix'})` route is
// dispatched BEFORE that fence, so each plugin has to enforce its own. Without
// this, any web page the user visits could read `/api/status` (email, project,
// tier) after rebinding a hostname to 127.0.0.1, spend the Google subscription
// quota through `/v1/chat/completions`, or blind-CSRF the mutating POSTs
// (`/api/logout`, `/api/login`, `/api/refresh-models`) — a simple
// `Content-Type: text/plain` POST needs no CORS preflight, so the browser would
// deliver it.
//
// The rules mirror DSH's: the request must be addressed to an authority we
// actually serve, must not be cross-site, and must not carry an Origin that
// disagrees with the Host it arrived on. Server-to-server calls from DSH itself
// carry no Origin and are unaffected.

// Authorities the bridge is willing to answer — the pure rule lives in
// protocol.js so it can be unit-tested directly.
function trustedAuthority(host) {
  return isTrustedAuthority(host, state.trustedHosts);
}

// Node reports a loopback peer as 127.0.0.1, ::1, or the IPv4-mapped
// ::ffff:127.0.0.1.
const LOOPBACK_PEER = /^(::1|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;

function isLoopbackPeer(req) {
  const address = req?.socket?.remoteAddress;
  if (!address) return true; // no transport at all: a synthetic in-process request
  return LOOPBACK_PEER.test(address);
}

// null when the request may proceed, otherwise the reason it must be refused.
function fenceReason(req) {
  const host = req.headers.host;
  if (typeof host !== 'string' || !host) {
    // No Host at all: a browser always sends one, so this is either an
    // in-process caller with a synthetic request (no socket) or a hand-rolled
    // client. Admit it only when it cannot have come from off-box. Otherwise a
    // client on an exposed bind (`dsh web --host 10.0.0.7`) would skip the
    // allow-list just by omitting the header, where it used to fail closed.
    if (!isLoopbackPeer(req)) return 'missing Host from a non-loopback peer';
  } else if (!trustedAuthority(host)) {
    return 'untrusted Host';
  }
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string' && site.trim().toLowerCase() === 'cross-site') return 'cross-site request';
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin) {
    // `null` is the opaque origin a sandboxed iframe or a `data:`/`file:` page
    // sends. DSH's own fence treats it as untrusted, so match that rather than
    // relying on the Sec-Fetch-Site rule alone.
    if (origin === 'null') return 'null Origin';
    let originHost;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return 'malformed Origin';
    }
    if (originHost !== String(host ?? '').trim().toLowerCase()) return 'Origin does not match Host';
  }
  return null;
}

export function apply(ctx) {
  pluginCtx = ctx;
  void refreshVersion();

  const route = ctx.webServer.register({
    kind: 'prefix',
    path: '/gemini-oauth-bridge',
    async handler(req, res) {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      const lang = resolveLang(req);
      const reply = (code, value) => json(res, code, renderPayload(value, lang));
      try {
        const refused = fenceReason(req);
        if (refused) return json(res, 403, { error: `refused: ${refused}` });

        // --- Settings UI API ---
        if (path === '/gemini-oauth-bridge/api/ping' && req.method === 'GET') {
          return reply(200, { ok: true, version: 1 });
        }
        if (path === '/gemini-oauth-bridge/api/status' && req.method === 'GET') {
          return reply(200, statusPayload());
        }
        if (path === '/gemini-oauth-bridge/api/login' && req.method === 'POST') {
          const result = await startLoginFlow(req.headers.host ? `http://${req.headers.host}` : null, lang);
          return reply(result.error ? 503 : 200, result);
        }
        if (path === '/gemini-oauth-bridge/api/logout' && req.method === 'POST') {
          await logout();
          return reply(200, { ok: true });
        }
        if (path === '/gemini-oauth-bridge/api/refresh-models' && req.method === 'POST') {
          if (!hasToken()) return reply(400, { error: message('notLoggedIn') });
          try {
            const token = await ensureAccessToken();
            state.models = await fetchAvailableModels(token);
            saveState();
          } catch (error) {
            return reply(502, { error: errorMessage(error) });
          }
          let provider;
          try {
            provider = await syncProvider(req.headers.host ? `http://${req.headers.host}` : null);
          } catch (error) {
            provider = { ok: false, reason: errorMessage(error) };
          }
          state.providerSyncResult = provider;
          saveState();
          return reply(200, { ok: true, models: state.models, provider });
        }
        if (path === '/gemini-oauth-bridge/api/refresh-version' && req.method === 'POST') {
          const info = await refreshVersion(true);
          return reply(200, info);
        }

        // --- OpenAI-compatible bridge (consumed by DSH providers) ---
        if (!checkApiKey(req)) return openaiError(res, 401, 'invalid bridge API key', 'unauthorized');
        if (path === '/gemini-oauth-bridge/v1/models' && req.method === 'GET') {
          // Same filter as the provider document: upstream's catalog also lists
          // internal routing ids (`chat_20706`, `tab_flash_lite_preview`) that
          // it rejects with 400 when used as a chat model.
          const models = (state.models ?? DEFAULT_MODELS).filter(isPublishableModelId);
          const created = Math.floor(Date.now() / 1000);
          return json(res, 200, {
            object: 'list',
            data: models.map((id) => ({ id, object: 'model', created, owned_by: 'google' })),
          });
        }
        if (path === '/gemini-oauth-bridge/v1/chat/completions' && req.method === 'POST') {
          const body = await readBody(req);
          return await handleChat(req, res, body, lang);
        }

        // --- Root: tiny human-readable summary ---
        if (path === '/gemini-oauth-bridge' || path === '/gemini-oauth-bridge/') {
          const st = statusPayload();
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          const t = (key, params) => escapeHtml(renderMessage(message(key, params), lang));
          return res.end(
            `<!doctype html><html lang="${lang}"><meta charset="utf-8"><title>gemini-oauth-bridge</title>` +
              `<body style="font-family:system-ui;padding:40px"><h2>dsh-gemini-oauth-bridge</h2><ul>` +
              `<li>${t('login', { value: st.loggedIn ? `✅ ${st.email}` : renderMessage(message('loggedOut'), lang) })}</li>` +
              `<li>${t('project', { project: st.project ?? '-', tier: st.tier ?? '-' })}</li>` +
              `<li>${t('version', { version: st.version, source: renderMessage(message(`source_${st.versionSource}`), lang) })}</li>` +
              `<li>${t('models', { models: st.models.join(', '), source: renderMessage(message(`source_${st.modelSource}`), lang) })}</li>` +
              `</ul><p>${t('endpoint')}<code>/gemini-oauth-bridge/v1</code></p></body></html>`,
          );
        }

        res.writeHead(404);
        res.end();
      } catch (error) {
        try {
          json(res, 500, { error: renderMessage(errorMessage(error), lang) });
        } catch {}
      }
    },
  });

  ctx.effect(() => {
    stopLoginFlow();
    return route;
  });
}
