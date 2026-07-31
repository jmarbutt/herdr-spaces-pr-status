import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS, loadConfig } from '../lib/config.js';

function withConfigDir(contents, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'prstatus-cfg-'));
  try {
    if (contents !== null) writeFileSync(join(dir, 'config.json'), contents);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('loadConfig returns defaults when there is no config dir at all', () => {
  assert.deepEqual(loadConfig(undefined), DEFAULTS);
  assert.deepEqual(loadConfig(null), DEFAULTS);
});

test('loadConfig returns defaults when the file is missing', () => {
  withConfigDir(null, (dir) => assert.deepEqual(loadConfig(dir), DEFAULTS));
});

test('loadConfig returns defaults rather than throwing on malformed JSON', () => {
  // A broken config must not take the sidebar down with it.
  withConfigDir('{ not json', (dir) => assert.deepEqual(loadConfig(dir), DEFAULTS));
});

test('loadConfig merges user values over defaults', () => {
  withConfigDir(JSON.stringify({ pollSeconds: 30, style: 'compact' }), (dir) => {
    const cfg = loadConfig(dir);
    assert.equal(cfg.pollSeconds, 30);
    assert.equal(cfg.style, 'compact');
    assert.equal(cfg.skipDefaultBranch, DEFAULTS.skipDefaultBranch);
  });
});

test('loadConfig clamps pollSeconds to something that will not hammer the API', () => {
  withConfigDir(JSON.stringify({ pollSeconds: 1 }), (dir) => {
    assert.ok(loadConfig(dir).pollSeconds >= 15);
  });
  withConfigDir(JSON.stringify({ pollSeconds: 999999 }), (dir) => {
    assert.ok(loadConfig(dir).pollSeconds <= 3600);
  });
});

test('loadConfig rejects a bogus style instead of passing it through', () => {
  withConfigDir(JSON.stringify({ style: 'klingon' }), (dir) => {
    assert.equal(loadConfig(dir).style, DEFAULTS.style);
  });
});

test('loadConfig ignores non-numeric numbers and non-boolean booleans', () => {
  withConfigDir(
    JSON.stringify({ pollSeconds: 'fast', skipDefaultBranch: 'yes', noPrCacheSeconds: null }),
    (dir) => {
      const cfg = loadConfig(dir);
      assert.equal(cfg.pollSeconds, DEFAULTS.pollSeconds);
      assert.equal(cfg.skipDefaultBranch, DEFAULTS.skipDefaultBranch);
      assert.equal(cfg.noPrCacheSeconds, DEFAULTS.noPrCacheSeconds);
    },
  );
});

test('loadConfig normalises repos to null or a non-empty array of strings', () => {
  withConfigDir(JSON.stringify({ repos: [] }), (dir) => assert.equal(loadConfig(dir).repos, null));
  withConfigDir(JSON.stringify({ repos: 'waycool/CoolFocus' }), (dir) =>
    assert.deepEqual(loadConfig(dir).repos, ['waycool/CoolFocus']),
  );
  withConfigDir(JSON.stringify({ repos: ['a/b', 2, null, 'c/d'] }), (dir) =>
    assert.deepEqual(loadConfig(dir).repos, ['a/b', 'c/d']),
  );
});

test('loadConfig filters notify to known classes', () => {
  withConfigDir(JSON.stringify({ notify: ['merged', 'nonsense', 'review'] }), (dir) => {
    assert.deepEqual(loadConfig(dir).notify, ['merged', 'review']);
  });
  withConfigDir(JSON.stringify({ notify: false }), (dir) => {
    assert.deepEqual(loadConfig(dir).notify, []);
  });
});

test('token ttl outlives several poll cycles so a dead daemon expires its own data', () => {
  withConfigDir(JSON.stringify({ pollSeconds: 90 }), (dir) => {
    const cfg = loadConfig(dir);
    assert.ok(cfg.tokenTtlMs > cfg.pollSeconds * 1000);
    // herdr rejects a ttl over 24h.
    assert.ok(cfg.tokenTtlMs <= 86400000);
  });
});
