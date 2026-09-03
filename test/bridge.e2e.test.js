// test/bridge.e2e.test.js — drives the full proxy path (OpenAI in → Code
// Assist out → OpenAI back) against a local mock upstream, with tokens and
// apiConfig pre-seeded into the isolated HOME's state file.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

const fakeHome = mkdtempSync(join(tmpdir(), 'gemini-oauth-bridge-e2e-'));
process.env.HOME = fakeHome;

// --- boot the mock upstream before anything else runs ---

const upstreamCalls = [];
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
          'gemini-3.1-pro-high': { displayName: 'Gemini 3.1 Pro (High)', maxCompletionTokens: 65536 },
          'claude-opus-4-6-thinking': { displayName: 'Claude Opus 4.6 (Thinking)' },
          'chat_20706': {},
          'tab_flash_lite_preview': {},
        },
      }));
      return;
    }
    if (path === '/v1internal:generateContent') {
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
const { port } = await new Promise((resolve) => {
  let handler = null;
  bridgeServer = http.createServer((req, res) => handler(req, res));
  apply({ webServer: { register(route) { handler = route.handler; return () => {}; } }, effect() {} });
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
  assert.match(text, new RegExp('llm-pi-ai:\\n  providers:\\n    gemini-oauth:\\n      api: openai-completions\\n      baseURL: http://127\\.0\\.0\\.1:' + port + '/gemini-oauth-bridge/v1\\n      models:\\n        - id: gemini-3\\.1-pro-high\\n        - id: claude-opus-4-6-thinking\\n$'));
  assert.ok(!text.includes('chat_20706'));
  assert.ok(!text.includes('tab_flash_lite_preview'));

  // second sync is byte-identical (idempotent)
  const before = text;
  const res2 = await fetch(`http://127.0.0.1:${port}/gemini-oauth-bridge/api/refresh-models`, { method: 'POST' });
  assert.equal(res2.status, 200);
  assert.equal(readFileSync(settingsPath, 'utf8'), before);
});
