// test/host.usage.test.js — boots the host with a pre-seeded state file to pin
// normalizeUsageStats at the boundary: a state that already carries real day
// buckets must never gain an invented hour bucket, whatever totals it carries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

// Isolate state: lib/index.js resolves ~/.dsh via os.homedir() at import time.
// os.homedir() reads HOME on POSIX but USERPROFILE on Windows, so both have to
// point at the temp dir or the suite reads the real ~/.dsh and asserts on it.
const fakeHome = mkdtempSync(join(tmpdir(), 'gemini-oauth-bridge-usage-'));
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;

const now = new Date();
const dayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const dayBucket = {
  requests: 37,
  succeeded: 37,
  failed: 0,
  rateLimited: 0,
  promptTokens: 1200,
  completionTokens: 300,
  totalTokens: 1500,
};
mkdirSync(join(fakeHome, '.dsh'), { recursive: true });
writeFileSync(
  join(fakeHome, '.dsh', 'gemini-oauth-bridge.json'),
  JSON.stringify({
    usageStats: { ...dayBucket, lastCallAt: now.getTime(), byModel: {}, byDay: { [dayKey]: { ...dayBucket } }, byHour: {} },
  }),
  'utf8',
);

const { apply } = await import('../lib/index.js');

test('real day buckets never gain an invented hour bucket at load', async () => {
  let handler = null;
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
    effect() {},
  };
  apply(ctx);
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/gemini-oauth-bridge/api/status`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.usageStats.byDay[dayKey].requests, 37, 'the seeded day bucket survives normalization');
    assert.deepEqual(Object.keys(body.usageStats.byHour), [], 'no hour bucket is invented for a state that has day buckets only');
  } finally {
    server.close();
  }
});
