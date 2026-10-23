// test/bridge.e2e.test.js — drives the full proxy path (OpenAI in → Code
// Assist out → OpenAI back) against a local mock upstream, with tokens and
// apiConfig pre-seeded into the isolated HOME's state file.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

const fakeHome = mkdtempSync(join(tmpdir(), 'gemini-oauth-bridge-e2e-'));
process.env.HOME = fakeHome;

// --- boot the mock upstream before anything else runs ---

const upstreamCalls = [];
// Counts upstream responses that the bridge abandoned mid-flight: the socket
// closed before the mock finished writing. If a cancelled DSH generation keeps
// draining the upstream, this stays flat.
const upstreamAborts = { count: 0 };
const upstream = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    upstreamCalls.push({
      path,
      auth: req.headers.authorization,
      ua: req.headers['user-agent'],
      body,
    });
    if (path === '/v1internal:streamGenerateContent') {
      if (upstream.mode === 'model404' || upstream.mode === 'plain404') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(upstream.mode === 'model404'
          ? { error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' } }
          : { error: { code: 404, message: 'routing miss' } }));
        return;
      }
      if (upstream.mode === '429') {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '1' });
        res.end(JSON.stringify({ error: { code: 429, message: 'quota', details: [{ retryDelay: '30s' }] } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (upstream.mode === 'fragment') {
        // dribble the SSE payload 3 bytes at a time to exercise line buffering
        const events = [
          'data: ' + JSON.stringify({ response: { candidates: [{ content: { role: 'model', parts: [{ text: 'AB' }] } }] } }) + '\n\n',
          'data: ' + JSON.stringify({ response: { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'CD' }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 } } }) + '\n\n',
          'data: [DONE]\n\n',
        ].join('');
        let i = 0;
        const timer = setInterval(() => {
          if (i >= events.length) { clearInterval(timer); res.end(); return; }
          res.write(events.slice(i, i + 3));
          i += 3;
        }, 1);
        return;
      }
      const wrap = (gem) => `data: ${JSON.stringify({ response: gem, traceId: 't' })}\n\n`;
      if (upstream.mode === 'slowstream') {
        // A long answer the client can walk away from mid-stream.
        res.on('close', () => {
          if (!res.writableEnded) upstreamAborts.count += 1;
        });
        let sent = 0;
        const timer = setInterval(() => {
          if (res.writableEnded || res.destroyed) { clearInterval(timer); return; }
          res.write(wrap({ candidates: [{ content: { role: 'model', parts: [{ text: 'x' }] } }] }));
          sent += 1;
          if (sent >= 200) { clearInterval(timer); res.end('data: [DONE]\n\n'); }
        }, 20);
        return;
      }
      if (upstream.mode === 'tools') {
        res.write(wrap({ candidates: [{ content: { role: 'model', parts: [{ text: 'checking', thought: true }] } }] }));
        res.write(wrap({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'get_weather', args: { city: 'hz' } }, thoughtSignature: 'SIG-1' }] } }] }));
        res.write(wrap({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [] } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2, totalTokenCount: 9 } }));
      } else {
        res.write(wrap({ candidates: [{ content: { role: 'model', parts: [{ text: '你好' }] } }] }));
        res.write(wrap({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: '，世界' }] } }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 } }));
      }
      res.end('data: [DONE]\n\n');
      return;
    }
    if (path === '/v1internal:fetchAvailableModels') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        models: {
          // limits in the upstream spelling; a parser reading only the legacy
          // camelCase aliases used to leave modelCaps permanently empty
          'gemini-3.1-pro-high': { displayName: 'Gemini 3.1 Pro (High)', maxTokens: 1048576, maxOutputTokens: 65536 },
          'claude-opus-4-6-thinking': { displayName: 'Claude Opus 4.6 (Thinking)' },
          'chat_20706': {},
          'tab_flash_lite_preview': {},
          // account may not use it: must never reach the provider model list
          'gemini-4-argon-disabled': {
            displayName: 'Gemini 4 Argon',
            disabled: true,
            tagTitle: 'Unavailable',
            tagDescription: 'Gemini 4 Argon is currently available to Ultra and paid Pro plan subscribers.',
          },
        },
      }));
      return;
    }
    if (path === '/v1internal:generateContent') {
      // Bodies that are not a completion: the bridge must not report these as a
      // successful empty answer.
      if (upstream.mode === 'garbage') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('<html>Error 502 (Bad Gateway)!!</html>');
        return;
      }
      if (upstream.mode === 'errorBody') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 400, message: 'INVALID_ARGUMENT: bad field' } }));
        return;
      }
      if (upstream.mode === 'emptyBody') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
        return;
      }
      if (upstream.mode === 'blocked') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ response: { promptFeedback: { blockReason: 'SAFETY' } }, traceId: 't' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          response: {
            candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'plain answer' }] } }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
          },
          traceId: 't',
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
});

await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const upstreamPort = upstream.address().port;

// --- seed state, then import the plugin (state is read at import time) ---

mkdirSync(join(fakeHome, '.dsh'), { recursive: true });
writeFileSync(
  join(fakeHome, '.dsh', 'gemini-oauth-bridge.json'),
  JSON.stringify({
    tokens: { access_token: 'test-at', refresh_token: 'test-rt', expiresAt: Date.now() + 3600_000 },
    email: 'tester@example.com',
    project: 'proj-x',
    tier: 'standard-tier',
    apiConfig: { generateBase: `http://127.0.0.1:${upstreamPort}` },
  }),
  { mode: 0o600 },
);

const { apply } = await import('../lib/index.js');

let bridgeServer;
let bridgeHandler = null;
const { port } = await new Promise((resolve) => {
  let handler = null;
  bridgeServer = http.createServer((req, res) => handler(req, res));
  apply({ webServer: { register(route) { handler = route.handler; return () => {}; } }, effect() {} });
  bridgeHandler = handler;
  bridgeServer.listen(0, '127.0.0.1', () => resolve({ port: bridgeServer.address().port }));
});

async function chat(body) {
  const res = await fetch(`http://127.0.0.1:${port}/gemini-oauth-bridge/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res;
}

after(() => {
  upstream.close();
  bridgeServer.close();
});

test('streaming bridge translates OpenAI → antigravity envelope → OpenAI chunks', async () => {
  const res = await chat({ model: 'gemini-3-pro', stream: true, messages: [{ role: 'user', content: '打个招呼' }] });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  const text = await res.text();
  const dataLines = text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6));
  assert.equal(dataLines[dataLines.length - 1], '[DONE]');
  const chunks = dataLines.slice(0, -1).map((l) => JSON.parse(l));
  assert.equal(chunks[0].object, 'chat.completion.chunk');
  assert.equal(chunks[0].model, 'gemini-3-pro');
  assert.equal(chunks[0].choices[0].delta.role, 'assistant');
  const contents = chunks.map((c) => c.choices[0].delta.content).filter(Boolean).join('');
  assert.equal(contents, '你好，世界');
  const finish = chunks.find((c) => c.choices[0].finish_reason);
  assert.equal(finish.choices[0].finish_reason, 'stop');
  assert.deepEqual(finish.usage, { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 });

  // upstream envelope contract
  const call = upstreamCalls.at(-1);
  assert.equal(call.path, '/v1internal:streamGenerateContent');
  assert.equal(call.auth, 'Bearer test-at');
  assert.match(call.ua, /^antigravity\/hub\/\d+\.\d+\.\d+ darwin\/arm64$/);
  assert.equal(call.body.model, 'gemini-3-pro');
  assert.equal(call.body.project, 'proj-x');
  assert.equal(call.body.requestType, 'agent');
  assert.match(call.body.requestId, /^agent-/);
  assert.equal(call.body.userAgent, 'antigravity');
  assert.match(call.body.request.sessionId, /^-\d+$/);
  assert.deepEqual(call.body.request.contents[0].parts[0].text, '打个招呼');
  // gemini-3 strip: maxOutputTokens must not reach upstream even if requested
  assert.ok(!('maxOutputTokens' in (call.body.request.generationConfig ?? {})));
});

test('non-stream bridge returns a full chat.completion object', async () => {
  const res = await chat({ model: 'gemini-2.5-flash', max_tokens: 128, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.object, 'chat.completion');
  assert.equal(json.choices[0].message.content, 'plain answer');
  assert.equal(json.choices[0].finish_reason, 'stop');
  assert.deepEqual(json.usage, { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });
  const call = upstreamCalls.at(-1);
  assert.equal(call.path, '/v1internal:generateContent');
  // non-gemini-3 keeps maxOutputTokens
  assert.equal(call.body.request.generationConfig.maxOutputTokens, 128);
});

test('tool calls stream as tool_calls deltas and capture thought signatures', async () => {
  upstream.mode = 'tools';
  try {
    const res = await chat({ model: 'gemini-3-pro', stream: true, messages: [{ role: 'user', content: 'weather?' }] });
    const text = await res.text();
    const chunks = text.split('\n').filter((l) => l.startsWith('data: ') && !l.includes('[DONE]')).map((l) => JSON.parse(l.slice(6)));
    const reasoning = chunks.find((c) => c.choices[0].delta.reasoning_content);
    assert.equal(reasoning.choices[0].delta.reasoning_content, 'checking');
    const toolChunk = chunks.find((c) => c.choices[0].delta.tool_calls);
    const tc = toolChunk.choices[0].delta.tool_calls[0];
    assert.equal(tc.function.name, 'get_weather');
    assert.equal(tc.function.arguments, '{"city":"hz"}');
    assert.match(tc.id, /^call_[0-9a-f]{24}/);
    const finish = chunks.find((c) => c.choices[0].finish_reason);
    assert.equal(finish.choices[0].finish_reason, 'tool_calls');
    // signature captured into the state file for cross-turn replay
    const saved = JSON.parse(readFileSync(join(fakeHome, '.dsh', 'gemini-oauth-bridge.json'), 'utf8'));
    assert.equal(saved.signatures[tc.id], 'SIG-1');

    // replay: a follow-up turn echoing the call id re-attaches the signature upstream
    upstream.mode = undefined;
    await chat({
      model: 'gemini-3-pro',
      stream: true,
      messages: [
        { role: 'user', content: 'weather?' },
        { role: 'assistant', content: null, tool_calls: [{ id: tc.id, type: 'function', function: { name: 'get_weather', arguments: '{"city":"hz"}' } }] },
        { role: 'tool', tool_call_id: tc.id, content: '30C' },
      ],
    });
    const replayCall = upstreamCalls.at(-1);
    const fcPart = replayCall.body.request.contents[1].parts[0];
    assert.equal(fcPart.functionCall.name, 'get_weather');
    assert.equal(fcPart.thoughtSignature, 'SIG-1');
    assert.equal(replayCall.body.request.contents[2].parts[0].functionResponse.name, 'get_weather');
  } finally {
    upstream.mode = undefined;
  }
});

test('429 upstream marks a cooldown and returns OpenAI-style 429 with Retry-After', async () => {
  upstream.mode = '429';
  try {
    const res = await chat({ model: 'gemini-3-pro', stream: true, messages: [{ role: 'user', content: 'x' }] });
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get('retry-after')) >= 1);
    const json = await res.json();
    assert.equal(json.error.type, 'rate_limit_error');
    // second call inside the cooldown window is refused locally (no upstream hit)
    const before = upstreamCalls.length;
    const again = await chat({ model: 'gemini-3-pro', stream: true, messages: [{ role: 'user', content: 'x' }] });
    assert.equal(again.status, 429);
    assert.equal(upstreamCalls.length, before);
  } finally {
    upstream.mode = undefined;
  }
});

test('streamed SSE survives byte-level fragmentation from upstream (cooldown bypassed via model choice)', async () => {
  upstream.mode = 'fragment';
  try {
    const res = await chat({ model: 'gemini-2.5-pro', stream: true, messages: [{ role: 'user', content: 'frag' }] });
    assert.equal(res.status, 200);
    const text = await res.text();
    const lines = text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6));
    assert.equal(lines[lines.length - 1], '[DONE]');
    const chunks = lines.slice(0, -1).map((l) => JSON.parse(l));
    const contents = chunks.map((c) => c.choices[0].delta.content).filter(Boolean).join('');
    assert.equal(contents, 'ABCD', 'no text lost across 3-byte chunk boundaries');
    const finish = chunks.find((c) => c.choices[0].finish_reason);
    assert.equal(finish.choices[0].finish_reason, 'stop');
    assert.deepEqual(finish.usage, { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 });
  } finally {
    upstream.mode = undefined;
  }
});

test('refresh-models syncs llm-pi-ai.providers.gemini-oauth into settings.yaml', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/gemini-oauth-bridge/api/refresh-models`, { method: 'POST' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.provider.ok, true);
  assert.equal(body.provider.models, 2, 'chat_/tab_ junk ids are filtered');

  const settingsPath = join(fakeHome, '.dsh', 'settings.yaml');
  const text = readFileSync(settingsPath, 'utf8');
  assert.match(text, new RegExp('llm-pi-ai:\\n  providers:\\n    gemini-oauth:\\n      api: openai-completions\\n      baseURL: http://127\\.0\\.0\\.1:' + port + '/gemini-oauth-bridge/v1\\n      apiKeyEnv: GEMINI_OAUTH_API_KEY\\n      models:\\n        - id: gemini-3\\.1-pro-high\\n        - id: claude-opus-4-6-thinking\\n$'));
  assert.ok(!text.includes('chat_20706'));
  assert.ok(!text.includes('tab_flash_lite_preview'));
  // an upstream-`disabled` model is advertised by the catalog but unusable; it
  // must not reach the provider list (this is what put gemini-4-argon-* in the
  // DSH picker, where every request could only ever 404)
  assert.ok(!text.includes('gemini-4-argon-disabled'), 'disabled upstream model must not be published');
  assert.ok(!body.models.includes('gemini-4-argon-disabled'));

  // caps now come from the upstream spellings (maxTokens / maxOutputTokens)
  const persisted = JSON.parse(readFileSync(join(fakeHome, '.dsh', 'gemini-oauth-bridge.json'), 'utf8'));
  assert.deepEqual(persisted.modelCaps['gemini-3.1-pro-high'], { contextLength: 1048576, maxCompletionTokens: 65536 });
  assert.equal(
    persisted.modelsUnavailable['gemini-4-argon-disabled'],
    'Gemini 4 Argon is currently available to Ultra and paid Pro plan subscribers.',
  );

  // the reason is exposed to the settings page as well
  const status = await (await fetch(`http://127.0.0.1:${port}/gemini-oauth-bridge/api/status`)).json();
  assert.equal(
    status.unavailableModels['gemini-4-argon-disabled'],
    'Gemini 4 Argon is currently available to Ultra and paid Pro plan subscribers.',
  );

  // DSH refuses a provider with no credential: the fixed placeholder key must
  // land in .credentials.yaml, 0600 (the loader rejects a looser mode).
  assert.equal(body.provider.apiKeyEnv, 'GEMINI_OAUTH_API_KEY');
  assert.deepEqual(body.provider.credential, { ok: true, created: true });
  const credPath = join(fakeHome, '.dsh', '.credentials.yaml');
  assert.equal(readFileSync(credPath, 'utf8'), 'version: 1\nrefs:\n  GEMINI_OAUTH_API_KEY: dsh-gemini-oauth-bridge\n');
  assert.equal(statSync(credPath).mode & 0o777, 0o600);

  // second sync is byte-identical (idempotent) for both documents
  const before = text;
  const credBefore = readFileSync(credPath, 'utf8');
  const res2 = await fetch(`http://127.0.0.1:${port}/gemini-oauth-bridge/api/refresh-models`, { method: 'POST' });
  assert.equal(res2.status, 200);
  assert.equal((await res2.json()).provider.credential.created, false);
  assert.equal(readFileSync(settingsPath, 'utf8'), before);
  assert.equal(readFileSync(credPath, 'utf8'), credBefore);
});

test('an upstream 404 NOT_FOUND names the model and the upstream reason', async () => {
  // load the disabled-model reasons into state first (order-independent)
  await fetch(`http://127.0.0.1:${port}/gemini-oauth-bridge/api/refresh-models`, { method: 'POST' });

  upstream.mode = 'model404';
  try {
    const res = await chat({ model: 'gemini-4-argon-disabled', stream: true, messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(res.status, 404);
    const json = await res.json();
    assert.equal(json.error.code, 'model_not_found');
    assert.match(json.error.message, /gemini-4-argon-disabled/);
    // the upstream's own entitlement reason is carried through
    assert.match(json.error.message, /Ultra and paid Pro plan subscribers/);
    assert.match(json.error.message, /刷新模型列表/);
    // Google's opaque wording must not be the whole answer
    assert.ok(!/^upstream 404/.test(json.error.message));
  } finally {
    upstream.mode = undefined;
  }
});

test('a 404 that is not NOT_FOUND still reports as a transport error', async () => {
  upstream.mode = 'plain404';
  try {
    // its own model id: gemini-3-pro carries a cooldown from the 429 test above
    const res = await chat({ model: 'plain-404-probe', stream: true, messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(res.status, 404);
    const json = await res.json();
    assert.equal(json.error.code, 'upstream');
    assert.match(json.error.message, /upstream 404/);
  } finally {
    upstream.mode = undefined;
  }
});

test('refresh-models hot-applies providers through the settings service when available', async () => {
  const updates = [];
  let hotHandler = null;
  const hotServer = http.createServer((req, res) => hotHandler(req, res));
  apply({
    webServer: { register(route) { hotHandler = route.handler; return () => {}; } },
    effect() {},
    get(name) {
      if (name !== 'settings') return undefined;
      return {
        async update(ns, patch) {
          updates.push({ ns, patch });
        },
      };
    },
  });
  const hotPort = await new Promise((resolve) => {
    hotServer.listen(0, '127.0.0.1', () => resolve(hotServer.address().port));
  });
  try {
    const legacyPath = join(fakeHome, '.dsh', 'settings.yaml');
    const legacyBefore = existsSync(legacyPath) ? readFileSync(legacyPath, 'utf8') : null;
    const res = await fetch(`http://127.0.0.1:${hotPort}/gemini-oauth-bridge/api/refresh-models`, { method: 'POST' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.provider.ok, true);
    assert.equal(body.provider.hotReload, true, 'settings-service sync must report a hot reload');
    assert.deepEqual(updates, [
      {
        ns: 'llm-pi-ai',
        patch: {
          providers: {
            'gemini-oauth': {
              api: 'openai-completions',
              baseURL: `http://127.0.0.1:${hotPort}/gemini-oauth-bridge/v1`,
              apiKeyEnv: 'GEMINI_OAUTH_API_KEY',
              models: [{ id: 'gemini-3.1-pro-high' }, { id: 'claude-opus-4-6-thinking' }],
            },
          },
        },
      },
    ]);

    // The legacy boot-only document must be left untouched once the hot path has
    // succeeded. On DSH ≥ 0.2 the next boot imports that file and renames it
    // over settings.yaml.imported, so rewriting it would clobber the archived
    // pre-migration document while changing nothing about the running process.
    const legacyAfter = existsSync(legacyPath) ? readFileSync(legacyPath, 'utf8') : null;
    assert.equal(legacyAfter, legacyBefore, 'a successful hot sync must not rewrite the legacy document');
  } finally {
    hotServer.close();
  }
});

// ---------- failure reporting on the non-streaming path ----------
//
// Every one of these used to answer 200 with `content: null` and
// `finish_reason: "stop"`, i.e. a silent empty answer the user cannot diagnose.

test('a non-JSON upstream body is reported as an upstream failure, not an empty answer', async (t) => {
  t.after(() => { upstream.mode = undefined; });
  upstream.mode = 'garbage';
  const res = await chat({ model: 'gemini-3.1-pro-high', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.match(body.error.message, /non-JSON/);
  assert.equal(body.error.type, 'api_error');
});

test('an upstream error envelope keeps its status instead of becoming an empty answer', async (t) => {
  t.after(() => { upstream.mode = undefined; });
  upstream.mode = 'errorBody';
  const res = await chat({ model: 'gemini-3.1-pro-high', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error.message, /INVALID_ARGUMENT: bad field/);
});

test('a 200 body with no candidates is an upstream failure, not an empty answer', async (t) => {
  t.after(() => { upstream.mode = undefined; });
  upstream.mode = 'emptyBody';
  const res = await chat({ model: 'gemini-3.1-pro-high', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.match(body.error.message, /no candidates/);
});

test('a safety-blocked prompt reports finish_reason content_filter', async (t) => {
  t.after(() => { upstream.mode = undefined; });
  upstream.mode = 'blocked';
  const res = await chat({ model: 'gemini-3.1-pro-high', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.choices[0].finish_reason, 'content_filter');
});

// ---------- cancellation ----------

test('a client disconnect aborts the upstream request instead of draining it', async () => {
  upstream.mode = 'slowstream';
  const before = upstreamAborts.count;
  const controller = new AbortController();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/gemini-oauth-bridge/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-3.1-pro-high', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
      signal: controller.signal,
    });
    const reader = res.body.getReader();
    await reader.read(); // first SSE chunk: the upstream is now mid-answer
    controller.abort(); // the user hit Esc / closed the tab
    // The bridge has to abort its own upstream fetch; otherwise the generation
    // keeps running and burning quota long after the client left.
    await new Promise((r) => setTimeout(r, 600));
    assert.ok(
      upstreamAborts.count > before,
      `upstream request must be abandoned on client disconnect (aborts stayed at ${before})`,
    );
  } finally {
    upstream.mode = undefined;
  }
});

// ---------- browser-trust fence ----------
//
// DSH's own fence covers its `/api/*` routes, but a plugin prefix route is
// dispatched before it, so the bridge enforces the same rules itself. These
// requests set the Host header explicitly, which `fetch` refuses to do.

function rawRequest({ path, method = 'GET', host, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method, headers: { ...(host ? { Host: host } : {}), ...headers } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('fence refuses a foreign Host (DNS rebinding) on the JSON API', async () => {
  const res = await rawRequest({ path: '/gemini-oauth-bridge/api/status', host: 'evil.example' });
  assert.equal(res.status, 403);
  assert.match(res.body, /untrusted Host/);
  // the account metadata must not leak
  assert.ok(!res.body.includes('@'), 'no email may be returned');
});

test('fence refuses a cross-site request even with a loopback Host', async () => {
  const res = await rawRequest({
    path: '/gemini-oauth-bridge/v1/models',
    host: `127.0.0.1:${port}`,
    headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
  });
  assert.equal(res.status, 403);
  assert.match(res.body, /cross-site request|Origin does not match Host/);
});

test('fence refuses an Origin that disagrees with the Host', async () => {
  const res = await rawRequest({
    path: '/gemini-oauth-bridge/api/status',
    host: `127.0.0.1:${port}`,
    headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'same-site' },
  });
  assert.equal(res.status, 403);
  assert.match(res.body, /Origin does not match Host/);
});

test('fence refuses a cross-site simple POST (would need no CORS preflight)', async () => {
  const res = await rawRequest({
    path: '/gemini-oauth-bridge/api/refresh-models',
    method: 'POST',
    host: 'evil.example',
    headers: { 'Content-Type': 'text/plain', 'Sec-Fetch-Site': 'cross-site' },
  });
  assert.equal(res.status, 403, 'a blind CSRF POST must never reach the handler');
});

test('fence lets the settings page through (same-origin loopback)', async () => {
  const res = await rawRequest({
    path: '/gemini-oauth-bridge/api/status',
    host: `127.0.0.1:${port}`,
    headers: { Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin' },
  });
  assert.equal(res.status, 200);
  assert.match(res.body, /"ok":true/);
});

test('fence lets DSH server-side provider calls through (no Origin, loopback Host)', async () => {
  for (const host of [`127.0.0.1:${port}`, `localhost:${port}`]) {
    const res = await rawRequest({ path: '/gemini-oauth-bridge/v1/models', host });
    assert.equal(res.status, 200, `loopback authority ${host} must stay reachable`);
    assert.match(res.body, /"object":"list"/);
  }
});

test('fence refuses a Host-less request from a non-loopback peer', async () => {
  // A browser always sends Host, so a request without one is either an
  // in-process/synthetic call or a hand-rolled client. On an exposed bind
  // (`dsh web --host 10.0.0.7`) that client must not skip the allow-list by
  // simply omitting the header, so absence is only tolerated from loopback.
  const direct = (socket) =>
    new Promise((resolve) => {
      const req = Object.assign(Readable.from([]), {
        url: '/gemini-oauth-bridge/api/status',
        method: 'GET',
        headers: {},
        socket,
      });
      const res = {
        writeHead(code) { resolve(code); return this; },
        end() {},
        setHeader() {},
        on() { return this; },
        writableEnded: false,
      };
      bridgeHandler(req, res);
    });
  assert.equal(await direct({ remoteAddress: '10.0.0.7' }), 403, 'a remote peer must not reach the API without a Host');
  assert.equal(await direct({ remoteAddress: '127.0.0.1' }), 200, 'a loopback peer keeps working');
  assert.equal(await direct(undefined), 200, 'an in-process request has no transport to trust either way');
});

