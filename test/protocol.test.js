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
