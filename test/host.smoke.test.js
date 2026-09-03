// test/host.smoke.test.js — boots the host half against a mocked cordis ctx
// and drives the real HTTP surface end to end (no Google network needed:
// login is exercised through the error/state-mismatch callback paths).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

// Isolate state: lib/index.js resolves ~/.dsh via os.homedir() at import time.
const fakeHome = mkdtempSync(join(tmpdir(), 'gemini-oauth-bridge-'));
process.env.HOME = fakeHome;

const { apply, inject } = await import('../lib/index.js');

test('module declares the webServer injection', () => {
  assert.deepEqual(inject, ['webServer']);
});

function bootHost() {
  let handler = null;
  const disposers = [];
  const ctx = {
    webServer: {
      register(route) {
        assert.equal(route.kind, 'prefix');
        assert.equal(route.path, '/gemini-oauth-bridge');
        handler = route.handler;
        return () => {
          handler = null;
        };
      },
    },
    effect(fn) {
      disposers.push(fn);
    },
  };
  apply(ctx);
  const server = http.createServer((req, res) => handler(req, res));
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, disposals: () => disposers.map((d) => d()) }));
  });
}

async function call(port, method, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}/gemini-oauth-bridge${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, text, json, headers: res.headers };
}

test('ping, status and default model list respond without login', async () => {
  const host = await bootHost();
  try {
    const ping = await call(host.port, 'GET', '/api/ping');
    assert.equal(ping.status, 200);
    assert.equal(ping.json.ok, true);

    const status = await call(host.port, 'GET', '/api/status');
    assert.equal(status.status, 200);
    assert.equal(status.json.loggedIn, false);
    assert.equal(status.json.modelSource, 'default');
    assert.match(status.json.version, /^\d+\.\d+\.\d+$/);

    const models = await call(host.port, 'GET', '/v1/models');
    assert.equal(models.status, 200);
    assert.equal(models.json.object, 'list');
    assert.ok(Array.isArray(models.json.data) && models.json.data.length > 0);
    assert.equal(models.json.data[0].object, 'model');
  } finally {
    host.server.close();
  }
});

test('chat completions without login returns an OpenAI-style 401', async () => {
  const host = await bootHost();
  try {
    const res = await call(host.port, 'POST', '/v1/chat/completions', {
      model: 'gemini-3-pro',
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(res.status, 401);
    assert.match(res.json.error.message, /登录/);
    assert.equal(res.json.error.type, 'api_error');

    const bad = await call(host.port, 'POST', '/v1/chat/completions', { model: 'x' });
    assert.equal(bad.status, 400);
  } finally {
    host.server.close();
  }
});

test('login flow: url issuance, state mismatch, google error, logout', async () => {
  const host = await bootHost();
  const base = 'http://127.0.0.1:51121';
  try {
    // 1. start login → callback listener comes up on 127.0.0.1:51121
    const login = await call(host.port, 'POST', '/api/login');
    assert.equal(login.status, 200, login.text);
    assert.match(login.json.authUrl, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
    const authUrl = new URL(login.json.authUrl);
    void authUrl; // state token validated indirectly through the callbacks below

    const status = await call(host.port, 'GET', '/api/status');
    assert.equal(status.json.loginPending, true);

    // 2. wrong state is rejected with a friendly HTML page and ends the flow
    const wrong = await fetch(`${base}/oauth-callback?code=zzz&state=wrong`);
    const wrongText = await wrong.text();
    assert.match(wrongText, /登录失败/);
    assert.match(wrongText, /过期|不匹配/);
    const afterWrong = await call(host.port, 'GET', '/api/status');
    assert.equal(afterWrong.json.loginPending, false);

    // 3. a fresh flow, then a Google-reported error surfaces verbatim and ends it
    const relogin = await call(host.port, 'POST', '/api/login');
    assert.equal(relogin.status, 200);
    const stateToken2 = new URL(relogin.json.authUrl).searchParams.get('state');
    const errored = await fetch(`${base}/oauth-callback?error=access_denied&state=${stateToken2}`);
    const erroredText = await errored.text();
    assert.match(erroredText, /access_denied/);
    const cleaned = await call(host.port, 'GET', '/api/status');
    assert.equal(cleaned.json.loginPending, false);

    // 4. a fresh flow can start afterwards
    const again = await call(host.port, 'POST', '/api/login');
    assert.equal(again.status, 200);
    assert.match(again.json.authUrl, /accounts\.google\.com/);

    // 5. logout clears everything
    const out = await call(host.port, 'POST', '/api/logout');
    assert.equal(out.status, 200);
    const after = await call(host.port, 'GET', '/api/status');
    assert.equal(after.json.loginPending, false);
    assert.equal(after.json.loggedIn, false);
  } finally {
    await call(host.port, 'POST', '/api/logout');
    host.server.close();
  }
});

test('state file stays inside the isolated HOME with no tokens after smoke', async () => {
  const statePath = join(fakeHome, '.dsh', 'gemini-oauth-bridge.json');
  assert.ok(existsSync(statePath));
  const raw = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.equal(raw.tokens, null);
  assert.equal(raw.email, null);
});
