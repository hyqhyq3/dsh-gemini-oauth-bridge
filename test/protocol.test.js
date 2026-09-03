// test/protocol.test.js — unit tests for lib/protocol.js (node:test, no deps).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OAUTH,
  API,
  VERSION,
  buildAuthUrl,
  callbackUrl,
  tokenExchangeForm,
  tokenRefreshForm,
  parseVersionManifest,
  userAgents,
  openaiToGeminiRequest,
  antigravityEnvelope,
  stableSessionId,
  sanitizeSchema,
  geminiToOpenaiFragments,
  freshTranslateState,
  assembleNonStreamResponse,
  extractSseEvents,
  unwrapStreamChunk,
  mapFinishReason,
  mapUsage,
} from '../lib/protocol.js';

// ---------- OAuth builders ----------

test('buildAuthUrl carries the registered redirect and full scope set', () => {
  const url = new URL(buildAuthUrl('st4te'));
  assert.equal(url.origin + url.pathname, OAUTH.authEndpoint);
  assert.equal(url.searchParams.get('client_id'), OAUTH.clientId);
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:51121/oauth-callback');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('state'), 'st4te');
  const scopes = url.searchParams.get('scope').split(' ');
  for (const s of OAUTH.scopes) assert.ok(scopes.includes(s), `missing scope ${s}`);
  assert.equal(callbackUrl(), 'http://localhost:51121/oauth-callback');
});

test('token forms carry grant types and client identity', () => {
  const ex = tokenExchangeForm('abc');
  assert.equal(ex.get('grant_type'), 'authorization_code');
  assert.equal(ex.get('code'), 'abc');
  assert.equal(ex.get('client_id'), OAUTH.clientId);
  assert.equal(ex.get('client_secret'), OAUTH.clientSecret);
  assert.equal(ex.get('redirect_uri'), 'http://localhost:51121/oauth-callback');

  const rf = tokenRefreshForm('rft');
  assert.equal(rf.get('grant_type'), 'refresh_token');
  assert.equal(rf.get('refresh_token'), 'rft');
  assert.equal(rf.get('client_id'), OAUTH.clientId);
});

// ---------- version manifest ----------

test('parseVersionManifest accepts the hub manifest shape and rejects junk', () => {
  assert.equal(parseVersionManifest('version: 2.9.4\nother: x\n'), '2.9.4');
  assert.equal(parseVersionManifest('version: "3.10.0"\n'), '3.10.0');
  assert.equal(parseVersionManifest('foo: 2.9.4'), null);
  assert.equal(parseVersionManifest('version: 2.9'), null);
  assert.equal(parseVersionManifest('version: v2.9.4'), null);
  assert.equal(parseVersionManifest(null), null);
  assert.ok(/^\d+\.\d+\.\d+$/.test(VERSION.fallback));
});

test('userAgents exposes the three identity forms', () => {
  const ua = userAgents('2.9.9');
  assert.equal(ua.short, 'antigravity/hub/2.9.9 darwin/arm64');
  assert.equal(ua.long, 'antigravity/hub/2.9.9 darwin/arm64 ' + VERSION.nodeApiClientUA);
  assert.equal(ua.refresh, 'Go-http-client/2.0');
});

// ---------- openai -> gemini ----------

test('system messages merge into systemInstruction, roles map correctly', () => {
  const { request } = openaiToGeminiRequest({
    messages: [
      { role: 'system', content: 'be brief' },
      { role: 'developer', content: 'no markdown' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'bye' },
    ],
  });
  assert.equal(request.systemInstruction.role, 'user');
  assert.deepEqual(request.systemInstruction.parts, [{ text: 'be brief' }, { text: 'no markdown' }]);
  assert.equal(request.contents.length, 3);
  assert.equal(request.contents[0].role, 'user');
  assert.deepEqual(request.contents[0].parts, [{ text: 'hi' }]);
  assert.equal(request.contents[1].role, 'model');
  assert.equal(request.contents[2].role, 'user');
});

test('tool_calls and tool results translate into functionCall/functionResponse', () => {
  const { request, toolNameByCallId } = openaiToGeminiRequest({
    messages: [
      { role: 'user', content: 'weather?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"hangzhou"}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"temp":30}' },
    ],
  });
  assert.equal(toolNameByCallId.get('call_1'), 'get_weather');
  const modelTurn = request.contents[1];
  assert.equal(modelTurn.role, 'model');
  assert.deepEqual(modelTurn.parts[0].functionCall, { name: 'get_weather', args: { city: 'hangzhou' } });
  const toolTurn = request.contents[2];
  assert.equal(toolTurn.role, 'user');
  assert.deepEqual(toolTurn.parts[0].functionResponse, {
    name: 'get_weather',
    response: { result: '{"temp":30}' },
  });
});

test('data-url images become inline_data; http urls degrade to text', () => {
  const { request } = openaiToGeminiRequest({
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
          { type: 'image_url', image_url: { url: 'https://example.com/x.png' } },
        ],
      },
    ],
  });
  const parts = request.contents[0].parts;
  assert.deepEqual(parts[0], { text: 'what is this' });
  assert.deepEqual(parts[1], { inline_data: { mime_type: 'image/png', data: 'AAAA' } });
  assert.match(parts[2].text, /^\[image omitted: https:/);
});

test('generationConfig maps and tools become functionDeclarations with sanitized schemas', () => {
  const { request } = openaiToGeminiRequest({
    messages: [{ role: 'user', content: 'x' }],
    temperature: 0.3,
    top_p: 0.9,
    max_tokens: 256,
    stop: ['END'],
    tools: [
      {
        type: 'function',
        function: {
          name: 'f',
          description: 'd',
          parameters: { $schema: 'http://x', type: 'object', properties: { a: { type: 'string', additionalProperties: false } }, additionalProperties: false },
        },
      },
    ],
  });
  assert.deepEqual(request.generationConfig, { temperature: 0.3, topP: 0.9, maxOutputTokens: 256, stopSequences: ['END'] });
  assert.deepEqual(request.tools, [{ functionDeclarations: [{ name: 'f', description: 'd', parameters: { type: 'object', properties: { a: { type: 'string' } } } }] }]);
});

test('sanitizeSchema strips unsupported vocabulary recursively', () => {
  const out = sanitizeSchema({
    $schema: 'x',
    additionalProperties: false,
    type: 'object',
    properties: { list: { type: 'array', items: { type: 'string', $id: 'y' } } },
  });
  assert.deepEqual(out, { type: 'object', properties: { list: { type: 'array', items: { type: 'string' } } } });
});

test('sanitizeSchema allowlist drops title/format/default/minimum/constraints at depth', () => {
  const out = sanitizeSchema({
    type: 'object',
    title: 'T',
    required: ['a', 5],
    properties: {
      a: {
        type: 'string',
        format: 'date-time',
        default: 'x',
        examples: ['y'],
        minLength: 2,
        pattern: '^a',
        description: 'keep me',
      },
      n: { type: 'integer', minimum: 0, maximum: 10, exclusiveMinimum: true, multipleOf: 2 },
      arr: { type: 'array', minItems: 1, maxItems: 3, uniqueItems: true, contains: { type: 'string' } },
      cond: { allOf: [{ type: 'string' }], if: true, then: {}, not: {} },
      meta: { type: 'object', propertyNames: { pattern: '^x' }, dependencies: { a: ['b'] } },
    },
  });
  assert.deepEqual(out, {
    type: 'object',
    required: ['a'],
    properties: {
      a: { type: 'string', description: 'keep me' },
      n: { type: 'integer' },
      arr: { type: 'array' },
      cond: {},
      meta: { type: 'object' },
    },
  });
});

test('sanitizeSchema converts const to enum including inside oneOf branches', () => {
  // The exact shape that produced upstream 400 "Unknown name \"const\"":
  // one_of[0].properties[0].value.const
  const out = sanitizeSchema({
    type: 'object',
    oneOf: [
      { type: 'object', properties: { kind: { const: 'path', type: 'string' } }, required: ['kind'] },
      { type: 'object', properties: { kind: { const: 'text', type: 'string' } }, required: ['kind'] },
    ],
    properties: { mode: { const: 'auto' } },
  });
  assert.deepEqual(out, {
    type: 'object',
    oneOf: [
      { type: 'object', properties: { kind: { type: 'string', enum: ['path'] } }, required: ['kind'] },
      { type: 'object', properties: { kind: { type: 'string', enum: ['text'] } }, required: ['kind'] },
    ],
    properties: { mode: { enum: ['auto'] } },
  });
});

test('sanitizeSchema flattens type unions, stringifies/drops enums, guards bad parameters', () => {
  assert.deepEqual(
    sanitizeSchema({ type: ['string', 'null'], enum: ['a', 2, true] }),
    { type: 'string', enum: ['a', '2', 'true'] },
  );
  // Non-string-typed enums cannot be enforced by the proto enum → dropped.
  assert.deepEqual(sanitizeSchema({ type: 'integer', enum: [1, 2] }), { type: 'integer' });
  // const under a non-string type is dropped, not stringified into a lie.
  assert.deepEqual(sanitizeSchema({ type: 'number', const: 5 }), { type: 'number' });
  // Garbage top-level parameters fall back to an empty object schema.
  assert.deepEqual(sanitizeSchema('nope'), { type: 'object', properties: {} });
  assert.deepEqual(sanitizeSchema([{ type: 'string' }]), { type: 'object', properties: {} });
  // Boolean property shorthand → unconstrained schema instead of leaking `true`.
  assert.deepEqual(sanitizeSchema({ type: 'object', properties: { a: true } }), {
    type: 'object',
    properties: { a: {} },
  });
});

test('openaiToGeminiRequest sanitizes real-world DSH tool schemas (const + oneOf)', () => {
  const { request } = openaiToGeminiRequest({
    messages: [{ role: 'user', content: 'x' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'edit',
          description: 'Edit a file',
          parameters: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            oneOf: [
              { properties: { kind: { const: 'replace' } }, required: ['kind'] },
              { properties: { kind: { const: 'insert' } }, required: ['kind'] },
            ],
            properties: { kind: { description: 'how to edit', const: 'replace' } },
            additionalProperties: false,
          },
        },
      },
    ],
  });
  const decl = request.tools[0].functionDeclarations[0];
  assert.equal(decl.name, 'edit');
  // Nothing the upstream proto does not know may survive sanitization.
  const allowed = new Set(['type', 'description', 'enum', 'items', 'properties', 'required', 'anyOf', 'oneOf', 'propertyOrdering']);
  const walk = (s) => {
    for (const [k, v] of Object.entries(s)) {
      assert.ok(allowed.has(k), `unexpected schema key ${k}`);
      if (v && typeof v === 'object' && !Array.isArray(v)) for (const sub of Object.values(v)) { if (sub && typeof sub === 'object') walk(sub); }
      if (Array.isArray(v)) for (const sub of v) { if (sub && typeof sub === 'object') walk(sub); }
    }
  };
  walk(decl.parameters);
  assert.deepEqual(decl.parameters.oneOf.map((b) => b.required), [['kind'], ['kind']]);
  assert.deepEqual(decl.parameters.properties.kind, { description: 'how to edit', enum: ['replace'] });
});

// ---------- envelope ----------

test('antigravityEnvelope wraps, strips, and keeps session identity', () => {
  const { request, sessionId } = openaiToGeminiRequest({
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first user line' },
    ],
  });
  const env = antigravityEnvelope('gemini-3-pro', 'proj-1', request, sessionId);
  assert.equal(env.model, 'gemini-3-pro');
  assert.equal(env.project, 'proj-1');
  assert.equal(env.requestType, 'agent');
  assert.equal(env.userAgent, 'antigravity');
  assert.match(env.requestId, /^agent-[0-9a-f-]{36}$/);
  assert.equal(env.request.sessionId, sessionId);
  assert.ok(!('safetySettings' in env.request));

  // gemini-3 drops maxOutputTokens; other knobs survive.
  assert.ok(!('maxOutputTokens' in (env.request.generationConfig || {})));
  const env2 = antigravityEnvelope('gemini-2.5-flash', '', { ...request, generationConfig: { temperature: 0.5, maxOutputTokens: 100 } }, sessionId);
  assert.ok(!('project' in env2));
  assert.equal(env2.request.generationConfig.maxOutputTokens, 100);
  assert.equal(env2.request.generationConfig.temperature, 0.5);
});

test('stableSessionId is deterministic and conversation-growth stable', () => {
  const base = [
    { role: 'system', content: 'sys prompt' },
    { role: 'user', content: 'the one seed' },
  ];
  const grown = [...base, { role: 'assistant', content: 'reply' }, { role: 'user', content: 'more' }];
  assert.equal(stableSessionId(base), stableSessionId(grown));
  assert.match(stableSessionId(base), /^-\d+$/);
  assert.notEqual(stableSessionId(base), stableSessionId([{ role: 'user', content: 'different' }]));
});

// ---------- gemini -> openai ----------

test('non-stream translation assembles text, thinking, tool_calls and usage', () => {
  const state = freshTranslateState({ stream: false, idSeed: 's1' });
  geminiToOpenaiFragments(
    {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              { text: 'let me think', thought: true },
              { text: 'Answer: 42' },
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 3, totalTokenCount: 18 },
    },
    state,
  );
  geminiToOpenaiFragments(
    {
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            role: 'model',
            parts: [{ functionCall: { name: 'f', args: { a: 1 } }, thoughtSignature: 'sig-abc' }],
          },
        },
      ],
    },
    state,
  );
  const resp = assembleNonStreamResponse(state, 'gemini-3-pro');
  assert.equal(resp.object, 'chat.completion');
  assert.equal(resp.model, 'gemini-3-pro');
  const msg = resp.choices[0].message;
  assert.equal(msg.content, 'Answer: 42');
  assert.equal(msg.reasoning_content, 'let me think');
  assert.equal(msg.tool_calls.length, 1);
  assert.equal(msg.tool_calls[0].function.name, 'f');
  assert.equal(msg.tool_calls[0].function.arguments, '{"a":1}');
  assert.equal(resp.choices[0].finish_reason, 'tool_calls');
  assert.deepEqual(resp.usage, { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 });
  assert.equal(state.signaturesById.get(msg.tool_calls[0].id), 'sig-abc');
});

test('stream translation emits deltas and a terminating chunk', () => {
  const state = freshTranslateState({ stream: true, idSeed: 's2' });
  const a = geminiToOpenaiFragments({ candidates: [{ content: { role: 'model', parts: [{ text: 'he' }] } }] }, state);
  const b = geminiToOpenaiFragments({ candidates: [{ content: { role: 'model', parts: [{ text: 'llo' }] } }] }, state);
  const c = geminiToOpenaiFragments(
    {
      candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [] } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 },
    },
    state,
  );
  assert.deepEqual(a, [{ delta: { content: 'he' } }]);
  assert.deepEqual(b, [{ delta: { content: 'llo' } }]);
  assert.equal(c.length, 1);
  assert.equal(c[0].finish_reason, 'stop');
  assert.deepEqual(c[0].usage, { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 });
});

test('thought parts stream as reasoning_content deltas', () => {
  const state = freshTranslateState({ stream: true, idSeed: 's3' });
  const out = geminiToOpenaiFragments(
    { candidates: [{ content: { role: 'model', parts: [{ text: 'hmm', thought: true }] } }] },
    state,
  );
  assert.deepEqual(out, [{ delta: { reasoning_content: 'hmm' } }]);
});

// ---------- SSE ----------

test('extractSseEvents splits complete lines and retains the partial tail', () => {
  const { events, rest } = extractSseEvents('data: {"a":1}\n\ndata: {"b":2}\r\ndata: {"c"');
  assert.deepEqual(events, ['{"a":1}', '{"b":2}']);
  assert.equal(rest, 'data: {"c"');
  const second = extractSseEvents('data: {"c":3}\nEND');
  assert.deepEqual(second.events, ['{"c":3}']);
  assert.equal(second.rest, 'END');
});

test('unwrapStreamChunk unwraps the antigravity envelope', () => {
  assert.deepEqual(unwrapStreamChunk({ response: { candidates: [1] }, traceId: 't' }), { candidates: [1] });
  assert.deepEqual(unwrapStreamChunk({ candidates: [1] }), { candidates: [1] });
  assert.deepEqual(unwrapStreamChunk(null), null);
});

// ---------- misc ----------

test('mapFinishReason and mapUsage follow the documented mapping', () => {
  assert.equal(mapFinishReason('STOP'), 'stop');
  assert.equal(mapFinishReason('MAX_TOKENS'), 'length');
  assert.equal(mapFinishReason('SAFETY'), 'content_filter');
  assert.equal(mapFinishReason('PROHIBITED_CONTENT'), 'content_filter');
  assert.equal(mapFinishReason(undefined), 'stop');
  assert.deepEqual(mapUsage({ promptTokenCount: 4, candidatesTokenCount: 2, thoughtsTokenCount: 6, totalTokenCount: 12 }), {
    prompt_tokens: 4,
    completion_tokens: 8,
    total_tokens: 12,
  });
  assert.equal(mapUsage(undefined), undefined);
});

// ---------- deterministic tool-call ids & signature replay ----------

test('tool-call ids are deterministic within a conversation and deduped per request', () => {
  const body = {
    messages: [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{"a":1}' } }] },
    ],
  };
  const idSeed = stableSessionId(body.messages);
  const r1 = openaiToGeminiRequest(body, { });
  const state = freshTranslateState({ stream: false, idSeed });
  const frags = geminiToOpenaiFragments({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ functionCall: { name: 'f', args: { a: 1 } } }] } }] }, state);
  void frags;
  const id1 = state.toolCalls[0].id;
  const state2 = freshTranslateState({ stream: false, idSeed });
  geminiToOpenaiFragments({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ functionCall: { name: 'f', args: { a: 1 } } }] } }] }, state2);
  assert.equal(state2.toolCalls[0].id, id1, 'same session + same call => same id across turns');
  // duplicate identical call in the same request gets a distinct id
  const state3 = freshTranslateState({ stream: false, idSeed });
  geminiToOpenaiFragments({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'f', args: { a: 1 } } }, { functionCall: { name: 'f', args: { a: 1 } } }] } }] }, state3);
  assert.notEqual(state3.toolCalls[0].id, state3.toolCalls[1].id);
  void r1;
});

test('history translation re-attaches thoughtSignature via opts.getSignature', () => {
  const body = {
    messages: [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_x', type: 'function', function: { name: 'f', arguments: '{"a":1}' } }] },
      { role: 'tool', tool_call_id: 'call_x', content: 'done' },
    ],
  };
  const { request } = openaiToGeminiRequest(body, { getSignature: (id) => (id === 'call_x' ? 'SIG' : undefined) });
  assert.equal(request.contents[1].parts[0].thoughtSignature, 'SIG');
  const { request: bare } = openaiToGeminiRequest(body);
  assert.ok(!('thoughtSignature' in bare.contents[1].parts[0]));
});

// ---------- tier resolution & model catalog parsing ----------

import { resolveTier, parseAvailableModels } from '../lib/protocol.js';

test('resolveTier prefers the paid subscription tier over currentTier', () => {
  assert.equal(resolveTier({ paidTier: { id: 'g1-pro-tier', name: 'Google AI Pro' }, currentTier: { id: 'free-tier' } }), 'g1-pro-tier');
  assert.equal(resolveTier({ currentTier: { id: 'standard-tier' } }), 'standard-tier');
  assert.equal(resolveTier({ allowedTiers: [{ id: 'free-tier', isDefault: true }] }), 'free-tier');
  assert.equal(resolveTier({}), 'free-tier');
  assert.equal(resolveTier(null), 'free-tier');
});

test('parseAvailableModels normalizes map and array shapes', () => {
  const map = parseAvailableModels({
    models: {
      'gemini-3.1-pro-low': { displayName: 'Gemini 3.1 Pro (Low)', contextLength: 1000000, maxCompletionTokens: 65536 },
      'claude-opus-4-6-thinking': { displayName: 'Claude Opus 4.6 (Thinking)' },
      '': { displayName: 'skipped' },
    },
  });
  assert.deepEqual(map.ids, ['gemini-3.1-pro-low', 'claude-opus-4-6-thinking']);
  assert.deepEqual(map.caps['gemini-3.1-pro-low'], { contextLength: 1000000, maxCompletionTokens: 65536 });
  assert.ok(!('claude-opus-4-6-thinking' in map.caps));

  const arr = parseAvailableModels({ models: ['a', { id: 'b', context_length: 8 }, { name: 'c' }] });
  assert.deepEqual(arr.ids, ['a', 'b', 'c']);
  assert.deepEqual(arr.caps.b, { contextLength: 8 });

  assert.deepEqual(parseAvailableModels({}), { ids: [], caps: {} });
  assert.deepEqual(parseAvailableModels(null), { ids: [], caps: {} });
});

// ---------- settings.yaml surgical merge ----------

import { mergeProviderYaml, buildProviderYamlLines } from '../lib/protocol.js';

const BODY6 = buildProviderYamlLines('127.0.0.1:3080', ['gemini-3.1-pro-high', 'claude-opus-4-6-thinking']);

test('mergeProviderYaml appends a fresh llm-pi-ai block to an unrelated file', () => {
  const before = 'model: glm-5.3-flash\nagent-default-model:\n  provider: zai-coding-cn\n';
  const r = mergeProviderYaml(before, 'gemini-oauth', BODY6);
  assert.ok(r.ok);
  assert.match(r.text, /\nllm-pi-ai:\n  providers:\n    gemini-oauth:\n      api: openai-completions\n/);
  assert.match(r.text, /agent-default-model:\n  provider: zai-coding-cn\n/);
  assert.ok(r.text.endsWith('\n'));
  // idempotent
  const again = mergeProviderYaml(r.text, 'gemini-oauth', BODY6);
  assert.equal(again.text, r.text);
});

test('mergeProviderYaml inserts the provider without touching sibling providers', () => {
  const before = [
    'llm-pi-ai:',
    '  providers:',
    '    kimi-coding:',
    '      apiKeyEnv: KIMI_CODING_API_KEY',
    '    zai-coding-cn:',
    '      apiKeyEnv: ZAI_CODING_CN_API_KEY',
    '      models:',
    '        - id: glm-5.3',
    '',
    'agent-default-model:',
    '  provider: zai-coding-cn',
  ].join('\n');
  const r = mergeProviderYaml(before, 'gemini-oauth', BODY6);
  assert.ok(r.ok);
  const out = r.text.split('\n');
  assert.match(r.text, /    gemini-oauth:\n      api: openai-completions\n      baseURL: http:\/\/127\.0\.0\.1:3080\/gemini-oauth-bridge\/v1\n      models:\n        - id: gemini-3\.1-pro-high\n        - id: claude-opus-4-6-thinking\n/);
  // siblings preserved verbatim and in order
  const kimi = out.indexOf('    kimi-coding:');
  const zai = out.indexOf('    zai-coding-cn:');
  const mine = out.indexOf('    gemini-oauth:');
  assert.ok(kimi !== -1 && zai !== -1 && mine !== -1);
  assert.ok(kimi < zai);
  assert.equal(out[out.length - 1], '  provider: zai-coding-cn');
  // idempotent
  assert.equal(mergeProviderYaml(r.text, 'gemini-oauth', BODY6).text, r.text);
});

test('mergeProviderYaml replaces an existing gemini-oauth block in place', () => {
  const before = [
    'llm-pi-ai:',
    '  providers:',
    '    gemini-oauth:',
    '      api: openai-completions',
    '      baseURL: http://127.0.0.1:3080/gemini-oauth-bridge/v1',
    '      models:',
    '        - id: gemini-3-pro',
    '    zai-coding-cn:',
    '      apiKeyEnv: ZAI_CODING_CN_API_KEY',
  ].join('\n');
  const r = mergeProviderYaml(before, 'gemini-oauth', BODY6);
  assert.ok(r.ok);
  assert.ok(!r.text.includes('gemini-3-pro\n'));
  assert.match(r.text, /- id: gemini-3\.1-pro-high\n/);
  // zai block survives, after the replaced block
  const mine = r.text.indexOf('    gemini-oauth:');
  const zai = r.text.indexOf('    zai-coding-cn:');
  assert.ok(mine !== -1 && zai > mine);
  assert.match(r.text, /    zai-coding-cn:\n      apiKeyEnv: ZAI_CODING_CN_API_KEY$/);
  assert.equal(mergeProviderYaml(r.text, 'gemini-oauth', BODY6).text, r.text);
});

test('mergeProviderYaml creates providers under an existing llm-pi-ai and refuses inline values', () => {
  const before = 'llm-pi-ai:\n  retryPolicy: x\n';
  const r = mergeProviderYaml(before, 'gemini-oauth', BODY6);
  assert.ok(r.ok);
  assert.match(r.text, /llm-pi-ai:\n  providers:\n    gemini-oauth:\n/);
  assert.match(r.text, /  retryPolicy: x\n/);

  const inline = 'llm-pi-ai: {}\n';
  assert.equal(mergeProviderYaml(inline, 'gemini-oauth', BODY6).ok, false);
});
