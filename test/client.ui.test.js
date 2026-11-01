// test/client.ui.test.js — evaluates lib/client.js as the classic browser script
// DSH ships: a window.__ModuleLoader__ module plus the settings.section entry.
// The React and DOM doubles cover only the surface the page touches.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const clientSource = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

function loadClient() {
  let pluginId;
  let plugin;
  const nodes = [];
  const head = {
    appendChild(node) {
      node.parentNode = head;
      nodes.push(node);
      return node;
    },
    removeChild(node) {
      const index = nodes.indexOf(node);
      if (index >= 0) nodes.splice(index, 1);
      node.parentNode = null;
      return node;
    },
  };
  const document = {
    head,
    createElement(tag) {
      return { tag, parentNode: null, attributes: {}, textContent: '', setAttribute(name, value) { this.attributes[name] = String(value); } };
    },
  };
  const react = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children };
    },
    useState(initial) {
      return [initial, () => {}];
    },
    useEffect() {},
  };
  const context = {
    window: {
      __ModuleLoader__: {
        load(module) {
          pluginId = module.id;
          plugin = module.factory(() => react);
        },
      },
    },
    document,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    setInterval: () => 0,
    clearInterval: () => {},
    URLSearchParams,
    console,
  };
  vm.runInNewContext(clientSource, context);
  assert.ok(plugin, 'client.js must register itself with window.__ModuleLoader__');
  assert.equal(pluginId, 'dsh-gemini-oauth-bridge');
  return { plugin, pluginId, document, nodes, react };
}

function boot(plugin) {
  const disposers = [];
  const injections = [];
  const registered = [];
  let dictionaries = null;
  const ctx = {
    effect(callback) {
      const dispose = callback();
      if (typeof dispose === 'function') disposers.push(dispose);
      return dispose;
    },
    locale: {
      register(namespace, dict) {
        assert.equal(namespace, 'geminiOauth');
        dictionaries = dict;
        return () => {};
      },
      bind() {
        return (key) => key;
      },
      getLocale() {
        return { active: 'en' };
      },
    },
    slots: {
      inject(name, callback) {
        injections.push(name);
        callback();
      },
      register(entry, component) {
        registered.push({ entry, component });
        return () => {};
      },
    },
  };
  plugin.apply(ctx);
  return { ctx, disposers, injections, registered, dictionaries };
}

test('client module registers exactly one settings.section entry', () => {
  const { plugin, pluginId } = loadClient();
  assert.equal(pluginId, 'dsh-gemini-oauth-bridge');
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale']);

  const runtime = boot(plugin);
  assert.deepEqual(runtime.injections, ['settings.section']);
  assert.equal(runtime.registered.length, 1);

  const { entry, component } = runtime.registered[0];
  assert.equal(entry.name, 'settings.section');
  assert.equal(entry.id, 'gemini-oauth-bridge');
  assert.equal(entry.order, 52);
  assert.equal(entry.locale, 'geminiOauth');
  assert.equal(typeof entry.label, 'function');
  assert.equal(entry.label(), 'sectionLabel');
  assert.equal(typeof component, 'function');
});

test('stylesheet is injected once and removed on dispose', () => {
  const { plugin, nodes } = loadClient();
  const runtime = boot(plugin);

  assert.equal(nodes.length, 1);
  const style = nodes[0];
  assert.equal(style.tag, 'style');
  assert.equal(style.attributes['data-dsh-plugin'], 'gemini-oauth-bridge');
  assert.match(style.textContent, /\.gob-root/);
  assert.match(style.textContent, /--dsw-alias-settings-card-fill/);
  assert.match(style.textContent, /prefers-reduced-motion: reduce/);

  for (const dispose of runtime.disposers) dispose();
  assert.equal(nodes.length, 0);
});

test('zh and en dictionaries keep identical keys and placeholders', () => {
  const { plugin } = loadClient();
  const dictionaries = plugin.__dictionaries;
  assert.ok(dictionaries && dictionaries.zh && dictionaries.en, 'the module exposes its dictionaries for the test');
  const { zh, en } = dictionaries;

  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const key of Object.keys(zh)) {
    assert.deepEqual(placeholders(zh[key]), placeholders(en[key]), key);
    for (const text of [zh[key], en[key]]) {
      assert.ok(!String(text).includes('✅'), key);
      assert.ok(!String(text).includes('\u2014'), key);
    }
  }

  // Keys the page already used stay available; the redesign adds its own.
  for (const key of ['connectionError', 'loginOpened', 'description', 'sectionLabel', 'refreshModels', 'refreshVersion', 'logout', 'modelsRefreshed', 'withSource', 'source_upstream']) {
    assert.ok(key in zh, key);
    assert.ok(key in en, key);
  }
  for (const key of ['stateSignedIn', 'stateSignedOut', 'statePending', 'stateLoading', 'stateError', 'hintSignedIn', 'hintSignedOut', 'hintPending', 'retry', 'configuration', 'factConfigurationLive', 'factConfigurationRestart', 'factConfigurationPending', 'factConfigurationFailed', 'howToTitle', 'howToIntro']) {
    assert.ok(key in zh, key);
    assert.ok(key in en, key);
  }
});

test('loading state renders the native section shell without actions', () => {
  const { plugin } = loadClient();
  const runtime = boot(plugin);
  const component = runtime.registered[0].component;
  const t = (key) => runtime.dictionaries.en[key] ?? key;

  const tree = component({ t });
  assert.equal(tree.type, 'section');
  assert.equal(tree.props.className, 'gob-root');
  const json = JSON.stringify(tree);
  assert.match(json, /Gemini OAuth/);
  assert.match(json, /Loading…/);
  assert.doesNotMatch(json, /Sign in with Google|Refresh model list|Retry/);
});
