import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadState, saveState, cacheKey, readCache, writeCache, EMPTY_STATE } from '../lib/state.js';

function withStateDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'prstatus-state-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const cfg = { noPrCacheSeconds: 180, terminalCacheMinutes: 1440 };
const NOW = 1_800_000_000_000;

test('loadState returns an empty state when nothing has been written', () => {
  withStateDir((dir) => assert.deepEqual(loadState(dir), EMPTY_STATE));
});

test('loadState survives a corrupt state file', () => {
  withStateDir((dir) => {
    writeFileSync(join(dir, 'state.json'), 'not json at all');
    assert.deepEqual(loadState(dir), EMPTY_STATE);
  });
});

test('loadState returns an empty state when there is no state dir', () => {
  assert.deepEqual(loadState(undefined), EMPTY_STATE);
});

test('saveState then loadState round-trips', () => {
  withStateDir((dir) => {
    const state = {
      spaces: { w69: { repo: 'o/n', branch: 'b', pr: { number: 1, rolled: 'open' } } },
      cache: { 'o/n#b': { at: NOW, pr: null } },
      updatedAt: NOW,
    };
    saveState(dir, state);
    assert.deepEqual(loadState(dir), state);
  });
});

test('saveState is a no-op without a state dir rather than throwing', () => {
  assert.doesNotThrow(() => saveState(undefined, EMPTY_STATE));
});

test('cacheKey is scoped by repo and branch', () => {
  assert.equal(cacheKey('waycool/CoolFocus', 'wc-1'), 'waycool/CoolFocus#wc-1');
  assert.notEqual(cacheKey('a/b', 'x'), cacheKey('a/c', 'x'));
});

test('a merged PR is cached for the long terminal window', () => {
  const cache = {};
  const merged = { number: 10108, rolled: 'merged' };
  writeCache(cache, 'o/n', 'b', merged, { now: NOW });
  // Well inside 24h: still a hit.
  assert.deepEqual(readCache(cache, 'o/n', 'b', cfg, { now: NOW + 60 * 60 * 1000 }), {
    hit: true,
    pr: merged,
  });
});

test('a merged PR cache entry expires after the terminal window', () => {
  const cache = {};
  writeCache(cache, 'o/n', 'b', { number: 1, rolled: 'merged' }, { now: NOW });
  const past = NOW + (cfg.terminalCacheMinutes + 1) * 60 * 1000;
  assert.equal(readCache(cache, 'o/n', 'b', cfg, { now: past }).hit, false);
});

test('a no-PR result is cached only briefly so a new PR shows up quickly', () => {
  const cache = {};
  writeCache(cache, 'o/n', 'b', null, { now: NOW });
  assert.deepEqual(readCache(cache, 'o/n', 'b', cfg, { now: NOW + 60 * 1000 }), {
    hit: true,
    pr: null,
  });
  const past = NOW + (cfg.noPrCacheSeconds + 1) * 1000;
  assert.equal(readCache(cache, 'o/n', 'b', cfg, { now: past }).hit, false);
});

test('an open PR is never cached, because that is exactly what changes', () => {
  const cache = {};
  writeCache(cache, 'o/n', 'b', { number: 1, rolled: 'checks_pending' }, { now: NOW });
  assert.equal(readCache(cache, 'o/n', 'b', cfg, { now: NOW }).hit, false);
  assert.equal(Object.keys(cache).length, 0);
});

test('readCache misses on an unknown key', () => {
  assert.equal(readCache({}, 'o/n', 'nope', cfg, { now: NOW }).hit, false);
});

test('readCache tolerates a junk cache entry', () => {
  const cache = { 'o/n#b': 'not an object' };
  assert.equal(readCache(cache, 'o/n', 'b', cfg, { now: NOW }).hit, false);
});

test('zero cache seconds disables caching entirely', () => {
  const cache = {};
  const off = { noPrCacheSeconds: 0, terminalCacheMinutes: 0 };
  writeCache(cache, 'o/n', 'b', null, { now: NOW });
  assert.equal(readCache(cache, 'o/n', 'b', off, { now: NOW }).hit, false);
});

test('closed PRs cache like merged ones', () => {
  const cache = {};
  writeCache(cache, 'o/n', 'b', { number: 2, rolled: 'closed' }, { now: NOW });
  assert.equal(readCache(cache, 'o/n', 'b', cfg, { now: NOW + 60 * 60 * 1000 }).hit, true);
});
