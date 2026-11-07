// test/client.ui.test.js — evaluates lib/client.js as the classic browser script
// DSH ships: a window.__ModuleLoader__ module plus the settings.section entry.
// The React and DOM doubles cover only the surface the page touches.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const clientSource = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

// The section reads its data through useState, so a test that wants a non-loading
// render queues the hook values the component will receive, in call order:
// status, busy, notice, loginFailed, attempt.
let hookQueue = null;

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
      if (hookQueue && hookQueue.length) return [hookQueue.shift(), () => {}];
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
  const runtime = boot(plugin);
  const dictionaries = runtime.dictionaries;
  assert.ok(dictionaries && dictionaries.zh && dictionaries.en, 'apply() registers the dictionaries through the locale slot');
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
  for (const key of ['stateSignedIn', 'stateSignedOut', 'statePending', 'stateLoading', 'stateError', 'hintSignedIn', 'hintSignedOut', 'hintPending', 'retry', 'configuration', 'factConfigurationLive', 'factConfigurationRestart', 'factConfigurationPending', 'factConfigurationDisabled', 'factConfigurationFailed', 'howToTitle', 'howToIntro']) {
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

const signedInStatus = {
  ok: true,
  loggedIn: true,
  email: 'user@example.com',
  project: 'project-1',
  tier: 'paid',
  models: ['gemini-3-pro'],
  modelSource: 'upstream',
  version: '1.2.3',
  versionSource: 'manifest',
  loginPending: false,
  providerSync: { at: 1, models: 1, host: '127.0.0.1:3080', hotReload: true },
  cooldowns: {},
};

function renderStatus(component, dictionaries, status) {
  const t = (key, params) => {
    const text = String(dictionaries.en[key] ?? key);
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])));
  };
  hookQueue = [status, false, null, false, 0];
  try {
    return component({ t });
  } finally {
    hookQueue = null;
  }
}

test('a provider-sync write failure is reported as failed in the error tone', () => {
  const { plugin } = loadClient();
  const runtime = boot(plugin);
  const component = runtime.registered[0].component;

  const tree = renderStatus(component, runtime.dictionaries, {
    ...signedInStatus,
    providerSync: { ok: false, reason: 'EPERM: operation not permitted' },
  });
  const json = JSON.stringify(tree);
  assert.match(json, /Configuration failed: EPERM: operation not permitted/);
  assert.match(json, /"data-tone":"error"/);
});

test('a disabled provider sync reads as disabled, without the error tone', () => {
  const { plugin } = loadClient();
  const runtime = boot(plugin);
  const component = runtime.registered[0].component;

  const tree = renderStatus(component, runtime.dictionaries, {
    ...signedInStatus,
    providerSync: { ok: false, skipped: true, reason: 'providerSync disabled in state file' },
  });
  const json = JSON.stringify(tree);
  assert.match(json, /Disabled in the state file/);
  assert.doesNotMatch(json, /Configuration failed/);
  assert.doesNotMatch(json, /"data-tone":"error"/);
});

// The section renders the tree the tests inspect, so the state table below walks
// the element doubles instead of matching against serialized JSON.
function walk(node, visit) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node !== 'object') {
    visit(node);
    return;
  }
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

function findAll(tree, predicate) {
  const found = [];
  walk(tree, (node) => {
    if (node && typeof node === 'object' && predicate(node)) found.push(node);
  });
  return found;
}

function textOf(node) {
  const parts = [];
  walk(node, (leaf) => {
    if (typeof leaf === 'string' || typeof leaf === 'number') parts.push(String(leaf));
  });
  return parts.join('').trim();
}

test('every status picks its own state label, dot, hint and actions', () => {
  const { plugin } = loadClient();
  const runtime = boot(plugin);
  const component = runtime.registered[0].component;
  const dictionaries = runtime.dictionaries;

  const cases = [
    {
      name: 'signed in',
      status: { ...signedInStatus, cooldowns: { 'gemini-3-pro': Date.now() + 60_000 } },
      label: 'Signed in',
      dot: 'success',
      hint: 'Requests use your subscription quota',
      actions: ['Sign in again', 'Refresh model list', 'Refresh quota', 'Refresh client version', 'Sign out'],
      hidden: ['Sign in with Google', 'Retry'],
      cooldown: /gemini-3-pro until /,
    },
    {
      name: 'signed out',
      status: { ...signedInStatus, loggedIn: false, email: null, project: null, tier: null, providerSync: null },
      label: 'Not signed in',
      dot: 'idle',
      hint: 'Open Google sign-in and complete the authorization',
      actions: ['Sign in with Google'],
      hidden: ['Sign in again', 'Refresh model list', 'Sign out', 'Retry'],
      cooldown: null,
    },
    {
      name: 'sign-in pending',
      status: { ...signedInStatus, loggedIn: false, email: null, loginPending: true },
      label: 'Sign-in in progress',
      dot: 'warning',
      hint: 'Complete the authorization in the browser tab that opened',
      actions: ['Sign in with Google'],
      hidden: ['Sign out', 'Retry'],
      cooldown: null,
    },
    {
      name: 'connection error',
      status: { ok: false, error: 'bridge unreachable' },
      label: 'Connection error',
      dot: 'error',
      actions: ['Retry'],
      hidden: ['Sign in with Google', 'Sign in again', 'Refresh model list', 'Sign out'],
      cooldown: null,
    },
  ];

  for (const expected of cases) {
    const tree = renderStatus(component, dictionaries, expected.status);
    const stateNode = findAll(tree, (node) => node.props && node.props.role === 'status')[0];
    assert.ok(stateNode, `${expected.name}: state row`);
    assert.equal(textOf(stateNode), expected.label, expected.name);

    const dot = findAll(stateNode, (node) => node.props && node.props.className === 'gob-dot')[0];
    assert.equal(dot.props['data-state'], expected.dot, `${expected.name}: dot`);

    const text = textOf(tree);
    if (expected.hint) assert.ok(text.includes(expected.hint), `${expected.name}: hint`);
    if (expected.cooldown) assert.match(text, expected.cooldown, `${expected.name}: cooldown`);

    const buttons = findAll(tree, (node) => node.type === 'button').map(textOf);
    for (const action of expected.actions) assert.ok(buttons.includes(action), `${expected.name}: ${action}`);
    for (const hidden of expected.hidden) assert.ok(!buttons.includes(hidden), `${expected.name}: ${hidden}`);
  }
});

test('signed-in status renders subscription quota groups with weekly and 5h buckets', () => {
  const { plugin } = loadClient();
  const runtime = boot(plugin);
  const component = runtime.registered[0].component;
  const dictionaries = runtime.dictionaries;

  const tree = renderStatus(component, dictionaries, {
    ...signedInStatus,
    quota: {
      fetchedAt: 1700000000000,
      groups: [
        {
          name: 'Gemini Models',
          buckets: [
            { id: 'gemini-weekly', window: 'weekly', remaining: 0.999, resetAt: 1700600000000, disabled: false },
            { id: 'gemini-5h', window: '5h', remaining: 0.25, resetAt: 1700018000000, disabled: false },
          ],
        },
        {
          name: 'Claude and GPT models',
          buckets: [
            { id: '3p-weekly', window: 'weekly', remaining: 0, resetAt: 1700600000000, disabled: false },
            { id: '3p-5h', window: '5h', remaining: 1, resetAt: null, disabled: true },
          ],
        },
      ],
    },
    usageStats: (() => {
      // The KPI cards summarise the *displayed period*, so the fixture has to
      // carry buckets inside the default 7-day window rather than a total.
      const now = new Date();
      const dayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const hourKey = `${dayKey}T${String(now.getHours()).padStart(2, '0')}`;
      const bucket = {
        requests: 5,
        succeeded: 4,
        failed: 1,
        rateLimited: 1,
        promptTokens: 12000,
        completionTokens: 3000,
        totalTokens: 15000,
      };
      return {
        requests: 5,
        succeeded: 4,
        failed: 1,
        rateLimited: 1,
        promptTokens: 12000,
        completionTokens: 3000,
        totalTokens: 15000,
        lastCallAt: now.getTime(),
        byModel: {
          'gemini-4-argon-high': { requests: 4, totalTokens: 14000 },
        },
        byDay: { [dayKey]: { ...bucket } },
        byHour: { [hourKey]: { ...bucket } },
      };
    })(),
    groupedModels: [
      { id: 'gemini-4-argon', reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' }, contextWindow: 1048576, maxTokens: 65536 },
    ],
    unavailableModels: {
      'gemini-4-argon-disabled': 'Requires Pro or Ultra',
    },
    tokenExpiresAt: 1700003600000,
    signatureCount: 12,
  });

  const text = textOf(tree);
  assert.match(text, /Quota/);
  assert.match(text, /Updated at /);
  assert.match(text, /Gemini Models/);
  assert.match(text, /Claude and GPT models/);
  assert.match(text, /Weekly limit/);
  assert.match(text, /5-hour limit/);
  assert.match(text, /100% remaining/);
  assert.match(text, /25% remaining/);
  assert.match(text, /0% remaining/);
  assert.match(text, /Inactive/);
  assert.match(text, /Local call usage/);
  assert.match(text, /Total calls/);
  assert.match(text, /7-day trend \(click a day for 24h\)/);
  assert.match(text, /← Back up/);
  assert.match(text, /Token share by model/);
  assert.match(text, /5 calls/);
  assert.match(text, /low\/medium\/high/);
  assert.match(text, /12 \/ 800/);
  assert.match(text, /Requires Pro or Ultra/);
});

// Losing the token must not collapse the page back to the single-pane layout the
// redesign replaced: the tab strip and its four panels stay, each panel explaining
// what signing in would unlock, and the model chips stay on the model tab only.
test('a signed-out status keeps the tab strip and keeps model chips off the overview tab', () => {
  const { plugin } = loadClient();
  const runtime = boot(plugin);
  const component = runtime.registered[0].component;
  const dictionaries = runtime.dictionaries;

  const tree = renderStatus(component, dictionaries, {
    ok: true,
    loggedIn: false,
    email: null,
    project: null,
    tier: null,
    version: '2.29.0',
    versionSource: 'cache',
    modelSource: 'upstream',
    groupedModels: [{ id: 'gemini-3.1-flash-lite', contextWindow: 1048576, maxTokens: 65535 }],
    quota: null,
    usageStats: { requests: 0 },
    loginPending: false,
    providerSync: { at: 1, models: 1, host: '127.0.0.1:3080', hotReload: true },
  });

  const tabs = findAll(tree, (node) => node.props && node.props.className === 'gob-tab').map(textOf);
  assert.equal(tabs.length, 4, 'all four tabs stay visible');
  for (const label of ['Overview', 'Quota', 'Usage charts', 'Models']) {
    assert.ok(tabs.some((text) => text.startsWith(label)), `tab: ${label}`);
  }

  const panels = findAll(tree, (node) => node.props && node.props.className === 'gob-panel');
  assert.equal(panels.length, 4, 'one panel per tab');

  // The overview keeps the account facts and shows the sign-in hint.
  assert.match(textOf(panels[0]), /Open Google sign-in and complete the authorization/);

  // Each locked tab explains the sign-in requirement instead of rendering empty.
  assert.match(textOf(panels[1]), /Sign in to see your subscription quota/);
  assert.match(textOf(panels[2]), /Sign in to start recording usage/);

  // Model chips belong to the model tab alone.
  const chips = (panel) => findAll(panel, (node) => node.props && node.props.className === 'gob-chip').length;
  assert.equal(chips(panels[0]), 0, 'overview must not repeat the model list');
  assert.equal(chips(panels[3]), 1, 'the model tab owns the chips');
  assert.match(textOf(panels[3]), /gemini-3\.1-flash-lite/);
});


