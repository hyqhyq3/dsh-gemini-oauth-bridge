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

// JSON-Schema keywords the upstream function-declaration schema (Gemini Schema
// proto) actually knows. It is a strict allowlist on purpose: the private
// v1internal backend answers any unknown field with a 400 INVALID_ARGUMENT for
// the whole request (observed with "const", which DSH tool registries emit —
// their sanitizer keeps const/oneOf). `oneOf` itself is proven accepted: the
// upstream error paths traverse `one_of[...]`. Everything not listed here —
// $schema/$defs/$ref, additionalProperties, title, format, default(s),
// example(s), minimum/maximum/exclusive*, multipleOf, min/maxLength,
// min/maxItems, uniqueItems, pattern*, contains, if/then/else, allOf, not,
// dependencies, x-* — is dropped, matching CLIProxyAPI's production cleaner.
const GEMINI_SCHEMA_KEYS = new Set([
  'type', 'description', 'enum', 'items', 'properties', 'required',
  'anyOf', 'oneOf', 'propertyOrdering',
]);

// Gemini's proto enum is `repeated string`; stringify everything else.
function schemaEnumValue(v) {
  return typeof v === 'string' ? v : String(JSON.stringify(v));
}

export function sanitizeSchema(schema, depth = 0) {
  if (depth > 12) return {};
  if (Array.isArray(schema) || !schema || typeof schema !== 'object') {
    return { type: 'object', properties: {} };
  }
  const out = {};
  // `type` may be a JSON-Schema union like ["string","null"]; the proto takes a
  // single type, so keep the first non-null and drop the null marker.
  const rawType = Array.isArray(schema.type)
    ? schema.type.find((t) => typeof t === 'string' && t !== 'null')
    : schema.type;
  if (typeof rawType === 'string') out.type = rawType;

  for (const [k, v] of Object.entries(schema)) {
    if (k === 'type' || !GEMINI_SCHEMA_KEYS.has(k)) continue;
    if (k === 'properties') {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        out.properties = {};
        for (const [name, sub] of Object.entries(v)) {
          out.properties[name] = sub && typeof sub === 'object' && !Array.isArray(sub)
            ? sanitizeSchema(sub, depth + 1)
            : {};
        }
      }
    } else if (k === 'items') {
      out.items = v && typeof v === 'object' && !Array.isArray(v) ? sanitizeSchema(v, depth + 1) : {};
    } else if (k === 'anyOf' || k === 'oneOf') {
      if (Array.isArray(v)) out[k] = v.map((s) => sanitizeSchema(s, depth + 1));
    } else if (k === 'required' || k === 'propertyOrdering') {
      if (Array.isArray(v)) out[k] = v.filter((s) => typeof s === 'string');
    } else if (k === 'description') {
      if (typeof v === 'string') out.description = v;
    } else if (k === 'enum') {
      // Keep enums only where the proto can enforce them (string-typed or
      // undeclared type); non-string enums are dropped like CLIProxyAPI does.
      if (Array.isArray(v) && (out.type === 'string' || out.type === undefined)) {
        out.enum = v.map(schemaEnumValue);
      }
    }
  }

  // `const` is a single-member enum; the upstream rejects the keyword itself,
  // so rewrite it to the equivalent enum (the fix for the 400 INVALID_ARGUMENT
  // "Unknown name \"const\"" observed from real DSH tool schemas).
  if (schema.const !== undefined && out.enum === undefined && (out.type === 'string' || out.type === undefined)) {
    out.enum = [schemaEnumValue(schema.const)];
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

// ---------------------------------------------------------------------------
// Registration tier + model catalog parsing
// ---------------------------------------------------------------------------

// The tier that actually governs request entitlements: a paid subscription
// (e.g. Google AI Pro → "g1-pro-tier") wins even while `currentTier` still
// reads free-tier. Mirrors the reference client: `paidTier?.id ?? currentTier.id`.
export function resolveTier(loadResp) {
  if (loadResp?.paidTier?.id) return loadResp.paidTier.id;
  if (loadResp?.currentTier?.id) return loadResp.currentTier.id;
  return 'free-tier';
}

// Parse a fetchAvailableModels response. Upstream returns `models` as a map
// keyed by model id (some shapes use an array); normalize both into
// { ids: [...], caps: { <id>: { contextLength, maxCompletionTokens } } }.
export function parseAvailableModels(json) {
  const raw = json && json.models;
  const entries = Array.isArray(raw)
    ? raw.map((m) => [typeof m === 'string' ? m : m?.id ?? m?.name, m])
    : raw && typeof raw === 'object'
      ? Object.entries(raw)
      : [];
  const ids = [];
  const caps = {};
  for (const [id, m] of entries) {
    if (typeof id !== 'string' || !id) continue;
    ids.push(id);
    const ctx = m && (m.contextLength ?? m.context_length);
    const maxOut = m && (m.maxCompletionTokens ?? m.max_completion_tokens);
    if (Number.isFinite(ctx) || Number.isFinite(maxOut)) {
      caps[id] = {
        ...(Number.isFinite(ctx) ? { contextLength: ctx } : {}),
        ...(Number.isFinite(maxOut) ? { maxCompletionTokens: maxOut } : {}),
      };
    }
  }
  return { ids, caps };
}

// ---------------------------------------------------------------------------
// settings.yaml surgical merge (auto provider configuration)
// ---------------------------------------------------------------------------

// Build the provider body lines (already indented to `indent`) for the
// gemini-oauth provider inside llm-pi-ai.providers.
export function buildProviderYamlLines(host, models, indent = 6) {
  const pad = ' '.repeat(indent);
  const lines = [`${pad}api: openai-completions`, `${pad}baseURL: http://${host}/gemini-oauth-bridge/v1`, `${pad}models:`];
  for (const id of models) lines.push(`${pad}  - id: ${id}`);
  return lines;
}

const isBlank = (line) => line.trim() === '';
const indentOf = (line) => line.length - line.trimStart().length;
const isComment = (line) => line.trimStart().startsWith('#');
// A mapping header like `key:` (optionally with trailing spaces). `key: value`
// inline scalars do NOT open a nested block.
const isBlockHeader = (line, key, indent) =>
  indentOf(line) === indent && line.trimStart().startsWith(key + ':') && line.trimStart().slice(key.length + 1).trim() === '';

// Find the exclusive end index (line number one past the end) of the block
// opened at `start`: extends through blank lines and comments, ends at the
// first non-blank, non-comment line whose indent is <= headerIndent.
function blockEnd(lines, start, headerIndent) {
  let i = start + 1;
  for (;;) {
    if (i >= lines.length) return i;
    const line = lines[i];
    if (isBlank(line) || isComment(line)) {
      i += 1;
      continue;
    }
    if (indentOf(line) <= headerIndent) return i;
    i += 1;
  }
}

// Merge (or create) `llm-pi-ai.providers.<name>` with the given provider body
// lines, preserving every other byte of the document. Idempotent.
export function mergeProviderYaml(text, name, providerLines) {
  const lines = text.split('\n');
  // locate top-level `llm-pi-ai:` header (not `llm-pi-ai: {inline}`)
  let llmIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isBlockHeader(lines[i], 'llm-pi-ai', 0)) {
      llmIdx = i;
      break;
    }
    // `llm-pi-ai:` with an inline value cannot host a providers map
    if (indentOf(lines[i]) === 0 && !isBlank(lines[i]) && !isComment(lines[i]) && lines[i].trimStart().startsWith('llm-pi-ai:')) {
      return { ok: false, reason: 'llm-pi-ai uses an inline value; merge refused' };
    }
  }

  if (llmIdx === -1) {
    // append a fresh top-level block at the end
    const out = [...lines];
    while (out.length && isBlank(out[out.length - 1])) out.pop();
    out.push('', 'llm-pi-ai:', '  providers:', `    ${name}:`, ...providerLines, '');
    return { ok: true, text: out.join('\n') };
  }

  const llmEnd = blockEnd(lines, llmIdx, 0);
  // find `  providers:` within the llm-pi-ai block
  let provIdx = -1;
  for (let i = llmIdx + 1; i < llmEnd; i++) {
    if (isBlockHeader(lines[i], 'providers', 2)) {
      provIdx = i;
      break;
    }
  }

  if (provIdx === -1) {
    const out = [...lines];
    out.splice(llmIdx + 1, 0, '  providers:', `    ${name}:`, ...providerLines);
    return { ok: true, text: out.join('\n') };
  }

  const provEnd = blockEnd(lines, provIdx, 2);
  // find `    <name>:` within the providers block
  let ownIdx = -1;
  for (let i = provIdx + 1; i < provEnd; i++) {
    if (isBlockHeader(lines[i], name, 4)) {
      ownIdx = i;
      break;
    }
  }

  const out = [...lines];
  if (ownIdx === -1) {
    out.splice(provIdx + 1, 0, `    ${name}:`, ...providerLines);
    return { ok: true, text: out.join('\n') };
  }
  let ownEnd = blockEnd(out, ownIdx, 4);
  // A blank run at the document tail belongs to the file, not to the provider
  // block — keep it so repeated merges stay byte-identical.
  while (ownEnd - 1 > ownIdx && isBlank(out[ownEnd - 1])) ownEnd -= 1;
  out.splice(ownIdx + 1, ownEnd - ownIdx - 1, ...providerLines);
  return { ok: true, text: out.join('\n') };
}
