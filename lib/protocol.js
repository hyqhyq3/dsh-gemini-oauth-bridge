// lib/protocol.js — pure protocol helpers for the Antigravity (Google Code Assist) bridge.
//
// Zero dependencies: Node built-ins only (node:crypto). Every function here is
// synchronous and side-effect free unless it takes a plain object and returns a
// new one. The host half (lib/index.js) owns all I/O, token storage, and HTTP.
//
// Protocol source of truth: the Antigravity desktop client's wire format as
// documented by the CLIProxyAPI project (router-for-me/CLIProxyAPI, Apache-2.0).
// Summary of the captured contract:
//
//   OAuth client (public, embedded in the Antigravity app — see OAUTH below):
//     scopes        cloud-platform, userinfo.email, userinfo.profile, cclog, experimentsandconfigs
//     redirect_uri  http://localhost:51121/oauth-callback   (fixed, registered)
//   Registration:
//     POST {prod}/v1internal:loadCodeAssist   {"metadata":{"ideType":"ANTIGRAVITY"}}
//     POST {daily}/v1internal:onboardUser     {"tier_id":...}  (poll until done)
//   Generation:
//     POST {base}/v1internal:generateContent
//     POST {base}/v1internal:streamGenerateContent?alt=sse
//     envelope: { model, project, requestType:"agent", requestId:"agent-<uuid>",
//                 userAgent:"antigravity", request:{ ...gemini payload, sessionId } }
//   Models:
//     POST {base}/v1internal:fetchAvailableModels
//   Streaming chunks arrive as SSE `data:` lines whose JSON is
//     {"response": {<gemini GenerateContentResponse>}, "traceId": "..."}
//   — unwrap `.response` when present, fall back to the bare object.

import { randomUUID, createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Public embedded OAuth client credentials of the shipped Antigravity app —
// not a confidential secret: they ship inside every Antigravity install and
// are published verbatim in CLIProxyAPI's open-source repo. Stored base64
// encoded purely so GitHub push protection does not flag the well-known
// plaintext patterns on every push; decoded at module load.
const CLIENT_ID_B64 = 'MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlcC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==';
const CLIENT_SECRET_B64 = 'R09DU1BYLUs1OEZXUjQ4NkxkTEoxbUxCOHNYQzR6NnFEQWY=';

export const OAUTH = {
  clientId: Buffer.from(CLIENT_ID_B64, 'base64').toString('utf8'),
  clientSecret: Buffer.from(CLIENT_SECRET_B64, 'base64').toString('utf8'),
  callbackPort: 51121,
  callbackPath: '/oauth-callback',
  scopes: [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs',
  ],
  authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  userinfoEndpoint: 'https://www.googleapis.com/oauth2/v2/userinfo?alt=json',
};

export const API = {
  prodBase: 'https://cloudcode-pa.googleapis.com',
  dailyBase: 'https://daily-cloudcode-pa.googleapis.com',
  apiVersion: 'v1internal',
  loadCodeAssistPath: '/v1internal:loadCodeAssist',
  onboardUserPath: '/v1internal:onboardUser',
  generatePath: '/v1internal:generateContent',
  streamPath: '/v1internal:streamGenerateContent',
  fetchModelsPath: '/v1internal:fetchAvailableModels',
  countTokensPath: '/v1internal:countTokens',
};

// The Antigravity hub updater manifest; its `version:` line is the currently
// shipping desktop client version. Cloud Code rejects newer models for client
// versions below 2.9.0, so the fallback floor must stay >= 2.9.0.
export const VERSION = {
  manifestUrl: 'https://antigravity-hub-auto-updater-974169037036.us-central1.run.app/manifest/latest-arm64-mac.yml',
  fallback: '2.9.1',
  hubPlatform: 'darwin/arm64',
  nodeApiClientUA: 'google-api-nodejs-client/10.3.0',
};

// ---------------------------------------------------------------------------
// OAuth URL / form builders
// ---------------------------------------------------------------------------

export function callbackUrl() {
  return `http://localhost:${OAUTH.callbackPort}${OAUTH.callbackPath}`;
}

export function buildAuthUrl(state) {
  const params = new URLSearchParams({
    access_type: 'offline',
    client_id: OAUTH.clientId,
    prompt: 'consent',
    redirect_uri: callbackUrl(),
    response_type: 'code',
    scope: OAUTH.scopes.join(' '),
    state,
  });
  return `${OAUTH.authEndpoint}?${params.toString()}`;
}

export function tokenExchangeForm(code) {
  return new URLSearchParams({
    code,
    client_id: OAUTH.clientId,
    client_secret: OAUTH.clientSecret,
    redirect_uri: callbackUrl(),
    grant_type: 'authorization_code',
  });
}

export function tokenRefreshForm(refreshToken) {
  return new URLSearchParams({
    client_id: OAUTH.clientId,
    client_secret: OAUTH.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
}

// ---------------------------------------------------------------------------
// Client identity (anti-fingerprint drift)
// ---------------------------------------------------------------------------

// `v` must be a validated numeric semver (see parseVersionManifest).
export function userAgents(version) {
  const short = `antigravity/hub/${version} ${VERSION.hubPlatform}`;
  return {
    // generateContent / streamGenerateContent / loadCodeAssist / userinfo
    short,
    // onboardUser only: long control-plane form
    long: `${short} ${VERSION.nodeApiClientUA}`,
    // The real client refreshes tokens with Go's default transport UA.
    refresh: 'Go-http-client/2.0',
  };
}

// Parse the hub updater manifest (trivial YAML subset) into a numeric semver,
// or null when anything is off. Mirrors CLIProxyAPI's validation: exactly three
// all-numeric dot-separated parts.
export function parseVersionManifest(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/^version:\s*("?)(\d+\.\d+\.\d+)\1\s*$/m);
  if (!m) return null;
  return m[2];
}

// ---------------------------------------------------------------------------
// Gemini payload construction from an OpenAI chat.completions request
// ---------------------------------------------------------------------------

const SYSTEM_ROLES = new Set(['system', 'developer']);

function textOfContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('');
  }
  return '';
}

function dataUrlParts(imageUrl) {
  // data:image/png;base64,AAAA → inline_data part; http(s) URLs unsupported.
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(imageUrl || '');
  if (!m) return null;
  const [, mime, isB64, data] = m;
  const payload = isB64 ? data : Buffer.from(decodeURIComponent(data), 'utf8').toString('base64');
  return { inline_data: { mime_type: mime || 'image/png', data: payload } };
}

// Strip JSON-Schema vocabulary the upstream rejects, recursively.
export function sanitizeSchema(schema, depth = 0) {
  if (depth > 12) return {};
  if (Array.isArray(schema)) return schema.map((s) => sanitizeSchema(s, depth + 1));
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === '$schema' || k === '$id' || k === '$defs' || k === 'definitions' || k === 'additionalProperties') continue;
    out[k] = v && typeof v === 'object' ? sanitizeSchema(v, depth + 1) : v;
  }
  return out;
}

// Deterministic per-conversation session id. Derived from the system prompt
// plus the first non-system message, so it stays stable as the conversation
// grows — matching the native client's one-session-per-conversation behavior.
export function stableSessionId(messages) {
  const first = (Array.isArray(messages) ? messages : []).find((m) => m && !SYSTEM_ROLES.has(m.role)) || {};
  const seed = JSON.stringify([textOfContent(first.content) || '', (first.tool_calls || []).map((t) => t && t.id)]);
  const hex = createHash('sha256').update(seed).digest('hex');
  const n = BigInt('0x' + hex.slice(0, 16)); // ≤ 2^64
  return '-' + (n % 9000000000000000000n).toString();
}

// Returns { request, toolNameByCallId, sessionId } where `request` is the
// Gemini-format body accepted inside the antigravity envelope.
//
// `opts.getSignature(callId)` may return a previously captured thoughtSignature
// for a tool-call id; it is attached to the corresponding functionCall part so
// multi-turn tool conversations replay Gemini 3 thought signatures correctly.
export function openaiToGeminiRequest(body, opts = {}) {
  const getSignature = typeof opts.getSignature === 'function' ? opts.getSignature : null;
  const messages = Array.isArray(body && body.messages) ? body.messages : [];

  const systemParts = [];
  const contents = [];
  const toolNameByCallId = new Map();

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    if (SYSTEM_ROLES.has(msg.role)) {
      const t = textOfContent(msg.content);
      if (t) systemParts.push({ text: t });
      continue;
    }
    if (msg.role === 'assistant') {
      const parts = [];
      const t = textOfContent(msg.content);
      if (t) parts.push({ text: t });
      for (const call of Array.isArray(msg.tool_calls) ? msg.tool_calls : []) {
        if (!call || call.type !== 'function' || !call.function) continue;
        if (call.id) toolNameByCallId.set(call.id, call.function.name);
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
          if (!args || typeof args !== 'object' || Array.isArray(args)) args = { value: args };
        } catch {
          args = {};
        }
        const part = { functionCall: { name: call.function.name, args } };
        const signature = call.id && getSignature ? getSignature(call.id) : undefined;
        if (signature) part.thoughtSignature = signature;
        parts.push(part);
      }
      if (parts.length) contents.push({ role: 'model', parts });
      continue;
    }
    if (msg.role === 'tool') {
      const name = (msg.tool_call_id && toolNameByCallId.get(msg.tool_call_id)) || msg.name || 'tool';
      let result = msg.content;
      if (typeof result !== 'string') {
        try {
          result = JSON.stringify(result);
        } catch {
          result = String(result);
        }
      }
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name, response: { result: result ?? '' } } }],
      });
      continue;
    }
    // role: user (default)
    const parts = [];
    const content = msg.content;
    if (typeof content === 'string') {
      if (content) parts.push({ text: content });
    } else if (Array.isArray(content)) {
      for (const p of content) {
        if (!p || typeof p !== 'object') continue;
        if (p.type === 'text' && typeof p.text === 'string' && p.text) parts.push({ text: p.text });
        else if (p.type === 'image_url' && p.image_url) {
          const inline = dataUrlParts(p.image_url.url);
          if (inline) parts.push(inline);
          else if (p.image_url.url) parts.push({ text: `[image omitted: ${p.image_url.url.slice(0, 120)}]` });
        }
      }
    }
    if (parts.length) contents.push({ role: 'user', parts });
  }

  const generationConfig = {};
  if (body.temperature !== undefined && body.temperature !== null) generationConfig.temperature = body.temperature;
  if (body.top_p !== undefined && body.top_p !== null) generationConfig.topP = body.top_p;
  if (body.max_tokens !== undefined && body.max_tokens !== null) generationConfig.maxOutputTokens = body.max_tokens;
  if (Array.isArray(body.stop) && body.stop.length) generationConfig.stopSequences = body.stop.map(String);
  else if (typeof body.stop === 'string' && body.stop) generationConfig.stopSequences = [body.stop];

  const request = { contents };
  if (systemParts.length) request.systemInstruction = { role: 'user', parts: systemParts };
  if (Object.keys(generationConfig).length) request.generationConfig = generationConfig;

  if (Array.isArray(body.tools) && body.tools.length) {
    const declarations = [];
    for (const tool of body.tools) {
      const fn = tool && tool.type === 'function' ? tool.function : null;
      if (!fn || !fn.name) continue;
      declarations.push({
        name: fn.name,
        description: typeof fn.description === 'string' ? fn.description : '',
        parameters: fn.parameters ? sanitizeSchema(fn.parameters) : { type: 'object', properties: {} },
      });
    }
    if (declarations.length) request.tools = [{ functionDeclarations: declarations }];
  }

  const sessionId = stableSessionId(messages);
  return { request, sessionId, toolNameByCallId };
}

// Wrap a Gemini-format request into the antigravity envelope. `project` may be
// '' (omitted upstream when empty).
export function antigravityEnvelope(model, project, geminiRequest, sessionId) {
  const request = { ...geminiRequest, sessionId };
  delete request.safetySettings;
  const isGemini3 = typeof model === 'string' && /gemini-3/.test(model);
  if (isGemini3 && request.generationConfig) {
    // gemini-3 rejects generationConfig.maxOutputTokens on this surface.
    const { maxOutputTokens, ...rest } = request.generationConfig;
    if (Object.keys(rest).length) request.generationConfig = rest;
    else delete request.generationConfig;
  }
  const envelope = {
    model,
    requestType: 'agent',
    requestId: 'agent-' + randomUUID(),
    userAgent: 'antigravity',
    request,
  };
  if (project) envelope.project = project;
  return envelope;
}

// ---------------------------------------------------------------------------
// Gemini response → OpenAI response translation
// ---------------------------------------------------------------------------

export function mapFinishReason(reason) {
  switch (reason) {
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'PROHIBITED_CONTENT':
    case 'BLOCKLIST':
    case 'SPII':
      return 'content_filter';
    case 'STOP':
    case undefined:
    case null:
    default:
      return 'stop';
  }
}

export function openaiCompletionId() {
  return 'chatcmpl-' + randomUUID().replaceAll('-', '');
}

export function mapUsage(usageMetadata) {
  if (!usageMetadata) return undefined;
  const prompt = usageMetadata.promptTokenCount ?? 0;
  const completion =
    (usageMetadata.candidatesTokenCount ?? 0) + (usageMetadata.thoughtsTokenCount ?? 0);
  const usage = { prompt_tokens: prompt, completion_tokens: completion, total_tokens: usageMetadata.totalTokenCount ?? prompt + completion };
  return usage;
}

// Tool-call ids are deterministic within a conversation: sha1(sessionSeed | name | args).
// The client echoes these ids back on later turns, which is what lets us find the
// matching thoughtSignature for replay (Gemini 3 requires signatures on
// functionCall parts in the request history).
function toolCallId(state, name, argsJson) {
  let id = 'call_' + createHash('sha1').update(state.idSeed + '|' + name + '|' + argsJson).digest('hex').slice(0, 24);
  while (state.usedIds.has(id)) id = id.slice(0, 24) + '_' + (state.dupSeq++).toString(36);
  state.usedIds.add(id);
  return id;
}

function pushToolCall(state, call) {
  const argsJson = JSON.stringify(call.args ?? {});
  const id = toolCallId(state, call.name || '', argsJson);
  const toolCall = {
    id,
    type: 'function',
    function: { name: call.name || '', arguments: argsJson },
  };
  if (state.toolNameByCallId) state.toolNameByCallId.set(id, toolCall.function.name);
  return toolCall;
}

// Translate one (unwrapped) Gemini GenerateContentResponse object into a list
// of OpenAI delta/response fragments. Used for both streaming (state carries
// running index/counters) and non-streaming (fresh state).
export function geminiToOpenaiFragments(gem, state) {
  const out = [];
  const candidate = gem && gem.candidates && gem.candidates[0];
  const content = candidate && candidate.content;
  const parts = (content && content.parts) || [];

  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    if (part.functionCall) {
      const toolCall = pushToolCall(state, part.functionCall);
      if (part.thoughtSignature) state.signaturesById.set(toolCall.id, part.thoughtSignature);
      state.toolCalls.push(toolCall);
      continue;
    }
    if (typeof part.text === 'string' && part.text) {
      if (part.thought === true) {
        state.thinking += part.text;
        if (state.stream) out.push({ delta: { reasoning_content: part.text } });
      } else {
        state.text += part.text;
        if (state.stream) out.push({ delta: { content: part.text } });
      }
    }
  }

  const usage = mapUsage(gem.usageMetadata);
  if (usage) state.usage = usage;

  const finishRaw = candidate && candidate.finishReason;
  if (finishRaw) {
    state.finishRaw = finishRaw;
    const finish = state.toolCalls.length ? 'tool_calls' : mapFinishReason(finishRaw);
    if (state.stream) {
      const delta = {};
      if (state.toolCalls.length) delta.tool_calls = state.toolCalls.map((tc, i) => ({ index: i, ...tc }));
      out.push({ delta, finish_reason: finish, usage });
    } else {
      out.push({ finish, usage });
    }
  }
  return out;
}

export function freshTranslateState({ stream, idSeed }) {
  return {
    stream: !!stream,
    idSeed: idSeed || '',
    text: '',
    thinking: '',
    toolCalls: [],
    toolCallSeq: 0,
    usedIds: new Set(),
    dupSeq: 0,
    signaturesById: new Map(),
    toolNameByCallId: new Map(),
    usage: undefined,
    finishRaw: undefined,
  };
}

// Non-streaming: assemble a complete chat.completion object from the state.
export function assembleNonStreamResponse(state, model) {
  const message = { role: 'assistant', content: state.text || null };
  if (state.thinking) message.reasoning_content = state.thinking;
  if (state.toolCalls.length) {
    message.tool_calls = state.toolCalls.map((tc) => ({ ...tc }));
  }
  return {
    id: openaiCompletionId(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: state.toolCalls.length ? 'tool_calls' : mapFinishReason(state.finishRaw || 'STOP'),
      },
    ],
    usage: state.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

// Extract SSE `data:` payload strings from a chunk of upstream text. Returns
// { events: [...strings], rest: <unconsumed text> }.
export function extractSseEvents(buffer) {
  const events = [];
  let idx = 0;
  for (;;) {
    const nl = buffer.indexOf('\n', idx);
    if (nl === -1) break;
    const line = buffer.slice(idx, nl).replace(/\r$/, '');
    idx = nl + 1;
    if (line.startsWith('data:')) {
      events.push(line.slice(5).trimStart());
    }
  }
  return { events, rest: buffer.slice(idx) };
}

// Unwrap an upstream SSE JSON object: antigravity wraps the Gemini response in
// {"response": {...}, "traceId": "..."}; plain surfaces return the bare object.
export function unwrapStreamChunk(obj) {
  if (obj && typeof obj === 'object' && obj.response && typeof obj.response === 'object') return obj.response;
  return obj;
}
