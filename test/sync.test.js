import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncOnce } from '../lib/sync.js';
import { DEFAULTS, loadConfig } from '../lib/config.js';
import { normalizePr } from '../lib/github.js';

const config = loadConfig(null);
const NOW = 1_800_000_000_000;

const SPACES = [
  { workspace_id: 'w69', label: 'WC-10200', dir: '/wt/a', repo: 'waycool/CoolFocus', branch: 'wc-10200' },
  { workspace_id: 'w6A', label: 'WC-10203', dir: '/wt/b', repo: 'waycool/CoolFocus', branch: 'wc-10203' },
  { workspace_id: 'w6B', label: 'BOT-1', dir: '/wt/c', repo: 'waycool/bot', branch: 'bot-1' },
];

function harness(over = {}) {
  const calls = { reported: [], notified: [], openPrs: [], branchPrs: [] };
  const deps = {
    snapshot: () => ({ workspaces: [], panes: [] }),
    resolveSpaces: () => SPACES,
    fetchOpenPrs: (repo) => {
      calls.openPrs.push(repo);
      return new Map();
    },
    fetchBranchPr: (repo, branch) => {
      calls.branchPrs.push(`${repo}#${branch}`);
      return null;
    },
    reportMetadata: (id, tokens) => {
      calls.reported.push([id, tokens]);
      return true;
    },
    showNotification: (title, body) => {
      calls.notified.push([title, body]);
      return true;
    },
    ...over,
  };
  return { deps, calls };
}

const openPr = (number, branch, over = {}) =>
  normalizePr({ number, headRefName: branch, state: 'OPEN', statusCheckRollup: [], ...over });

test('syncOnce reports tokens for every resolved space', () => {
  const { deps, calls } = harness({
    fetchOpenPrs: (repo) =>
      repo === 'waycool/CoolFocus'
        ? new Map([
            ['wc-10200', openPr(1, 'wc-10200')],
            ['wc-10203', openPr(2, 'wc-10203')],
          ])
        : new Map([['bot-1', openPr(3, 'bot-1')]]),
  });
  const res = syncOnce({ config, deps, now: NOW });
  assert.equal(res.ok, true);
  assert.equal(calls.reported.length, 3);
  assert.equal(res.stats.spaces, 3);
  assert.match(calls.reported.find(([id]) => id === 'w69')[1].pr, /#1$/);
});

test('syncOnce makes exactly one open-PR query per repo', () => {
  const { deps, calls } = harness({
    fetchOpenPrs: (repo) => {
      calls.openPrs.push(repo);
      return repo === 'waycool/CoolFocus'
        ? new Map([
            ['wc-10200', openPr(1, 'wc-10200')],
            ['wc-10203', openPr(2, 'wc-10203')],
          ])
        : new Map([['bot-1', openPr(3, 'bot-1')]]);
    },
  });
  const res = syncOnce({ config, deps, now: NOW });
  // Three spaces, two repos, two calls.
  assert.equal(res.stats.repoQueries, 2);
  assert.equal(res.stats.branchQueries, 0);
  assert.deepEqual(calls.openPrs.sort(), ['waycool/CoolFocus', 'waycool/bot']);
});

test('syncOnce falls back to a per-branch query only for unmatched branches', () => {
  const { deps, calls } = harness({
    fetchOpenPrs: () => new Map([['wc-10200', openPr(1, 'wc-10200')]]),
    fetchBranchPr: (repo, branch) => {
      calls.branchPrs.push(`${repo}#${branch}`);
      return branch === 'wc-10203'
        ? normalizePr({ number: 9, headRefName: branch, state: 'MERGED', statusCheckRollup: [] })
        : null;
    },
  });
  const res = syncOnce({ config, deps, now: NOW });
  assert.deepEqual(calls.branchPrs.sort(), ['waycool/CoolFocus#wc-10203', 'waycool/bot#bot-1']);
  assert.equal(res.state.spaces.w6A.pr.rolled, 'merged');
  assert.equal(res.state.spaces.w6B.pr, null);
});

test('a merged result is cached and skips both queries next cycle', () => {
  const { deps, calls } = harness({
    resolveSpaces: () => [SPACES[1]],
    fetchOpenPrs: (repo) => {
      calls.openPrs.push(repo);
      return new Map();
    },
    fetchBranchPr: (repo, branch) => {
      calls.branchPrs.push(`${repo}#${branch}`);
      return normalizePr({ number: 9, headRefName: branch, state: 'MERGED', statusCheckRollup: [] });
    },
  });
  const first = syncOnce({ config, deps, now: NOW });
  assert.equal(first.stats.branchQueries, 1);

  const second = syncOnce({ config, deps, state: first.state, now: NOW + 60_000 });
  assert.equal(second.stats.cacheHits, 1);
  assert.equal(second.stats.repoQueries, 0, 'a fully cached repo needs no query at all');
  assert.equal(second.stats.branchQueries, 0);
  assert.equal(second.state.spaces.w6A.pr.rolled, 'merged');
});

test('an open PR is re-queried every cycle because it is what changes', () => {
  const { deps } = harness({
    resolveSpaces: () => [SPACES[0]],
    fetchOpenPrs: () => new Map([['wc-10200', openPr(1, 'wc-10200')]]),
  });
  const first = syncOnce({ config, deps, now: NOW });
  const second = syncOnce({ config, deps, state: first.state, now: NOW + 1000 });
  assert.equal(second.stats.cacheHits, 0);
  assert.equal(second.stats.repoQueries, 1);
});

test('bypassCache forces a fresh query even for a cached merge', () => {
  const { deps } = harness({
    resolveSpaces: () => [SPACES[1]],
    fetchBranchPr: (repo, branch) =>
      normalizePr({ number: 9, headRefName: branch, state: 'MERGED', statusCheckRollup: [] }),
  });
  const first = syncOnce({ config, deps, now: NOW });
  const forced = syncOnce({ config, deps, state: first.state, now: NOW + 1000, bypassCache: true });
  assert.equal(forced.stats.cacheHits, 0);
  assert.equal(forced.stats.branchQueries, 1);
});

test('a space with no PR gets its tokens cleared, not left stale', () => {
  const { deps, calls } = harness({ resolveSpaces: () => [SPACES[0]] });
  syncOnce({ config, deps, now: NOW });
  const [, tokens] = calls.reported[0];
  assert.deepEqual(Object.values(tokens), [null, null, null, null]);
});

test('a failed repo query does not fan out into a query per branch', () => {
  const { deps, calls } = harness({ fetchOpenPrs: () => null });
  const res = syncOnce({ config, deps, now: NOW });
  assert.equal(res.ok, true);
  assert.deepEqual(calls.branchPrs, [], 'no targeted query on a connection that just failed');
  assert.equal(res.stats.failed, 3);
});

test('a failed repo query reports nothing, so the token ttl blanks the space', () => {
  const { deps, calls } = harness({ fetchOpenPrs: () => null });
  const res = syncOnce({ config, deps, now: NOW });
  assert.deepEqual(calls.reported, [], 'an unanswered space is neither refreshed nor cleared');
  assert.equal(res.stats.reported, 0);
});

test('a failed repo query does not cache "no PR" for the branches it never asked about', () => {
  const { deps } = harness({ fetchOpenPrs: () => null });
  const failed = syncOnce({ config, deps, now: NOW });
  assert.deepEqual(failed.state.cache, {}, 'a failure is not an answer worth remembering');

  // The next cycle must be free to ask again rather than serving the blank.
  const back = harness({ fetchOpenPrs: () => new Map([['wc-10200', openPr(1, 'wc-10200')]]) });
  const recovered = syncOnce({ config, deps: back.deps, state: failed.state, now: NOW + 1000 });
  assert.equal(recovered.stats.cacheHits, 0);
  assert.equal(recovered.state.spaces.w69.pr.number, 1);
});

test('an unanswered space keeps its last known PR as a notification baseline', () => {
  const red = openPr(1, 'wc-10200', {
    statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }],
  });
  const first = syncOnce({
    config,
    deps: harness({ resolveSpaces: () => [SPACES[0]], fetchOpenPrs: () => new Map([['wc-10200', red]]) }).deps,
    now: NOW,
    firstCycle: true,
  });

  const outage = syncOnce({
    config,
    deps: harness({ resolveSpaces: () => [SPACES[0]], fetchOpenPrs: () => null }).deps,
    state: first.state,
    now: NOW + 1000,
  });
  assert.equal(outage.state.spaces.w69.pr.number, 1, 'baseline survives the outage');

  // Without the baseline the same failing checks would toast again on recovery.
  const after = harness({ resolveSpaces: () => [SPACES[0]], fetchOpenPrs: () => new Map([['wc-10200', red]]) });
  const recovered = syncOnce({ config, deps: after.deps, state: outage.state, now: NOW + 2000 });
  assert.deepEqual(recovered.notifications, [], 'no re-toast for a transition already announced');
});

test('a failed branch query leaves the space unanswered instead of inventing "no PR"', () => {
  const { deps, calls } = harness({
    resolveSpaces: () => [SPACES[1]],
    fetchOpenPrs: () => new Map(),
    fetchBranchPr: () => undefined,
  });
  const res = syncOnce({ config, deps, now: NOW });
  assert.equal(res.stats.branchQueries, 1);
  assert.equal(res.stats.failed, 1);
  assert.deepEqual(calls.reported, []);
  assert.deepEqual(res.state.cache, {});
});

test('tokens are reported with the configured ttl so a dead daemon expires them', () => {
  const seen = [];
  const { deps } = harness({
    resolveSpaces: () => [SPACES[0]],
    reportMetadata: (_id, _tokens, opts) => {
      seen.push(opts.ttlMs);
      return true;
    },
  });
  syncOnce({ config, deps, now: NOW });
  assert.equal(seen[0], config.tokenTtlMs);
  assert.ok(config.tokenTtlMs > DEFAULTS.pollSeconds * 1000);
});

test('syncOnce fires notifications on a real transition and not on the first cycle', () => {
  const green = () => new Map([['wc-10200', openPr(1, 'wc-10200')]]);
  const red = () =>
    new Map([
      [
        'wc-10200',
        openPr(1, 'wc-10200', {
          statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }],
        }),
      ],
    ]);

  const h1 = harness({ resolveSpaces: () => [SPACES[0]], fetchOpenPrs: red });
  const first = syncOnce({ config, deps: h1.deps, now: NOW, firstCycle: true });
  assert.deepEqual(h1.calls.notified, [], 'first cycle stays quiet');

  const h2 = harness({ resolveSpaces: () => [SPACES[0]], fetchOpenPrs: green });
  const good = syncOnce({ config, deps: h2.deps, state: first.state, now: NOW + 1000 });

  const h3 = harness({ resolveSpaces: () => [SPACES[0]], fetchOpenPrs: red });
  const bad = syncOnce({ config, deps: h3.deps, state: good.state, now: NOW + 2000 });
  assert.equal(bad.notifications.length, 1);
  assert.equal(bad.notifications[0].kind, 'checks_failed');
  assert.equal(h3.calls.notified.length, 1);
});

test('syncOnce reports a failure instead of throwing when the snapshot is unreadable', () => {
  const { deps, calls } = harness({ snapshot: () => null });
  const res = syncOnce({ config, deps, now: NOW });
  assert.equal(res.ok, false);
  assert.match(res.error, /snapshot/);
  assert.equal(calls.reported.length, 0);
});

test('syncOnce with no spaces does nothing quietly', () => {
  const { deps, calls } = harness({ resolveSpaces: () => [] });
  const res = syncOnce({ config, deps, now: NOW });
  assert.equal(res.ok, true);
  assert.equal(res.stats.spaces, 0);
  assert.equal(calls.reported.length, 0);
  assert.equal(calls.openPrs.length, 0);
});
