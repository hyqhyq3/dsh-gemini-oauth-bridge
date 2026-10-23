import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import http from 'node:http';
import { Readable } from 'node:stream';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as protocol from '../lib/protocol.js';

const clientSource = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const hostSource = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
function parity(zh, en) {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  for (const key of Object.keys(zh)) {
    const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(placeholders(zh[key]), placeholders(en[key]), key);
  }
}
function host(overrides = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-i18n-'));
  let callback, handler;
  const context = vm.createContext({ ...fs, ...os, ...path, ...crypto, ...protocol,
    homedir: () => home, process: { env: { DSH_HOME: home } }, URL, console,
    setTimeout: () => 1, clearTimeout() {}, AbortSignal, AbortController, Buffer,
    fetch: async () => { throw new Error('offline'); },
    createServer(fn) { callback = fn; return { on() {}, once() {}, listen(port, addr, fn) { fn(); }, close() {} }; },
  });
  const source = hostSource.replace(/^import [\s\S]*? from '[^']+';\n/gm, '').replace(/export /g, '');
  vm.runInContext(source + '\n globalThis.subject = { zh, en, resolveLang, message, renderMessage, renderPayload, callbackPage, apply, syncProvider, localizedError };', context);
  const subject = context.subject;
  context.overrides = overrides;
  vm.runInContext(`
    if (overrides.ensureAccessToken) ensureAccessToken = overrides.ensureAccessToken;
    if (overrides.refreshTokens) refreshTokens = overrides.refreshTokens;
    if (overrides.fetch) fetch = overrides.fetch;
  `, context);
  subject.apply({ webServer: { register(route) { handler = route.handler; return () => {}; } }, effect() {} });
  async function call(url, method = 'GET', cb = false, payload) {
    let body, status;
    const res = { writeHead(code) { status = code; return this; }, end(text) { body = text; }, setHeader() {} };
    const req = Object.assign(Readable.from(payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))]), { url, method, headers: {} });
    await (cb ? callback : handler)(req, res);
    return { status, body };
  }
  return { ...subject, home, call, handler };
}

test('client dictionary parity, locale declarations, injected t and live API language', async () => {
  let plugin, dictionaries, section, Component, active = 'en', requested;
  const elements = [];
  const react = { createElement(type, props, ...children) { const el = { type, props, children }; elements.push(el); return el; },
    useState: () => [null, () => {}], useCallback: (fn) => fn, useEffect: (fn) => fn() };
  vm.runInNewContext(clientSource, { window: { __ModuleLoader__: { load: ({ factory }) => { plugin = factory(() => react); } } }, URLSearchParams,
    fetch: async (url) => { requested = url; return { ok: true, status: 200, json: async () => ({}) }; }, setInterval() {}, clearInterval() {} });
  const t = (key) => dictionaries[active][key];
  plugin.apply({ effect(fn) { fn(); }, locale: { register(ns, dict) { assert.equal(ns, 'geminiOauth'); dictionaries = dict; }, bind: () => t, getLocale: () => ({ active }) },
    slots: { inject(name, fn) { fn(); }, register(entry, component) { section = entry; Component = component; } } });
  parity(dictionaries.zh, dictionaries.en);
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale']);
  assert.equal(section.locale, 'geminiOauth');
  assert.equal(Component({ t }).children[0], 'Loading…');
  assert.match(requested, /\?lang=en$/);
  active = 'zh'; Component({ t });
  assert.match(requested, /\?lang=zh$/);
  assert.match(clientSource, /path\.includes\("\?"\) \? "&" : "\?"/);
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'));
});

test('host dictionary parity and durable preference precedence', () => {
  const h = host(); parity(h.zh, h.en);
  const settings = path.join(h.home, 'settings.yaml');
  assert.equal(h.resolveLang({ url: '/' }), 'zh');
  for (const value of ['en', '"en"', "'en'"]) {
    fs.writeFileSync(settings, `other:\n  preference: zh\nlocale: # language\n  preference: ${value} # chosen\n`);
    assert.equal(h.resolveLang({ url: '/?lang=xx' }), 'en');
    assert.equal(h.resolveLang({ url: '/?lang=zh' }), 'zh');
  }
  for (const text of ['garbage', 'locale:\n  preference: fr', 'locale: broken\n  preference: en', 'other:\n  preference: en']) {
    fs.writeFileSync(settings, text); assert.equal(h.resolveLang({ url: '/' }), 'zh');
  }
});

test('JSON errors, persisted descriptors, root and callbacks follow locale; upstream text is preserved', async () => {
  const h = host();
  for (const lang of ['zh', 'en']) {
    const result = await h.call(`/gemini-oauth-bridge/api/refresh-models?lang=${lang}`, 'POST');
    assert.equal(result.status, 400);
    assert.equal(JSON.parse(result.body).error, h.renderMessage(h.message('notLoggedIn'), lang));
    const root = await h.call(`/gemini-oauth-bridge/?lang=${lang}`);
    assert.ok(root.body.includes(lang === 'en' ? 'Client version impersonation' : '客户端版本伪装'));
    await h.call(`/gemini-oauth-bridge/api/login?lang=${lang}`, 'POST');
    fs.writeFileSync(path.join(h.home, 'settings.yaml'), `locale:\n  preference: ${lang === 'en' ? 'zh' : 'en'}\n`);
    const callback = await h.call('/oauth-callback?error=access_denied', 'GET', true);
    assert.ok(callback.body.includes(h.renderMessage(h.message('loginFailure'), lang)));
    assert.ok(callback.body.includes('access_denied'));
    const success = h.callbackPage(true, h.message('accountSummary', { email: 'user@example.com', project: 'project-1', tier: 'paid' }), lang);
    assert.ok(success.includes(h.renderMessage(h.message('loginSuccess'), lang)));
    assert.ok(success.includes('user@example.com'));
    const external = 'Google 原文 <denied> & details';
    assert.equal(h.renderMessage(external, lang), external);
    assert.ok(h.callbackPage(false, h.message('googleError', { error: external }), lang).includes('Google 原文 &lt;denied&gt; &amp; details'));
  }
  // syncProvider is async: the provider write goes through the settings
  // service (hot path) before falling back to the legacy document.
  const persisted = JSON.parse(JSON.stringify(await h.syncProvider(null)));
  assert.equal(persisted.reason.key, 'noModels');
  assert.match(h.renderPayload(persisted, 'en').reason, /refresh the model list/);
});

const chatBody = { model: 'gemini-3-pro', messages: [{ role: 'user', content: 'hi' }] };
function assertNotLoggedIn(h, result, lang) {
  assert.equal(result.status, 401);
  assert.deepEqual(JSON.parse(result.body), { error: {
    message: h.renderMessage(h.message('notLoggedIn'), lang),
    type: 'api_error', code: 'not_logged_in',
  } });
}

test('chat authentication errors follow locale with the OpenAI envelope intact', async (t) => {
  const h = host();
  t.after(() => fs.rmSync(h.home, { recursive: true, force: true }));
  for (const lang of ['zh', 'en']) {
    const result = await h.call(`/gemini-oauth-bridge/v1/chat/completions?lang=${lang}`, 'POST', false, chatBody);
    t.diagnostic(`lang=${lang} -> ${result.status} ${result.body}`);
    assertNotLoggedIn(h, result, lang);
  }
});

test('HTTP chat without a token localizes authentication errors', async (t) => {
  const h = host();
  const server = http.createServer(h.handler);
  t.after(() => { server.close(); fs.rmSync(h.home, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  for (const lang of ['zh', 'en']) {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/gemini-oauth-bridge/v1/chat/completions?lang=${lang}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chatBody),
    });
    assertNotLoggedIn(h, { status: res.status, body: await res.text() }, lang);
  }
});

test('bridge error catches render descriptors and preserve raw errors and upstream fragments', async (t) => {
  const upstreamText = 'Google 原文 <denied> & details\r\n{status} $& café 🚫';
  for (const stage of ['token', 'retry', 'route']) {
    for (const localized of [true, false]) {
      let failure;
      const h = host({
        ensureAccessToken: async () => { if (stage === 'token') throw failure; return 'token'; },
        fetch: async () => ({ status: 401 }),
        refreshTokens: async () => { throw failure; },
      });
      t.after(() => fs.rmSync(h.home, { recursive: true, force: true }));
      const descriptor = h.message('refreshRejected', { status: 403, text: upstreamText });
      failure = localized ? h.localizedError('refresh rejected', descriptor) : new Error(upstreamText);
      for (const lang of ['zh', 'en']) {
        let result;
        if (stage === 'route') {
          const req = { url: `/gemini-oauth-bridge/v1/chat/completions?lang=${lang}`, method: 'POST', headers: {},
            async *[Symbol.asyncIterator]() { throw failure; } };
          result = {};
          await h.handler(req, { writeHead(status) { result.status = status; }, end(body) { result.body = body; } });
        } else {
          result = await h.call(`/gemini-oauth-bridge/v1/chat/completions?lang=${lang}`, 'POST', false, chatBody);
        }
        const body = JSON.parse(result.body);
        const actual = stage === 'route' ? body.error : body.error.message;
        assert.equal(result.status, stage === 'route' ? 500 : 401);
        if (stage !== 'route') {
          assert.equal(body.error.code, 'not_logged_in');
          assert.equal(body.error.type, 'api_error');
        }
        assert.equal(actual, localized ? h.renderMessage(descriptor, lang) : upstreamText);
        const fragment = localized ? actual.slice(actual.indexOf(upstreamText), actual.indexOf(upstreamText) + upstreamText.length) : actual;
        assert.deepEqual(Buffer.from(fragment), Buffer.from(upstreamText));
        if (localized) assert.ok(actual.includes('(403)'));
      }
    }
  }
});
