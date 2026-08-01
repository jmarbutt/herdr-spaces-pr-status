import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, groupChecks, renderChecksPlain, CHECK_GROUPS } from '../lib/checks-render.js';
import { normalizeCheckDetail, checkDetails, fetchPrChecks } from '../lib/github.js';
import { displayWidth } from '../lib/width.js';

const space = { workspace_id: 'w6F', label: 'WC-10207', branch: 'wc-10207-catalog' };
const pr = {
  number: 10112,
  title: 'WC-10207: Catalog: Reports module missing from all package moduleIds',
  rolled: 'checks_pending',
  review: null,
  additions: 42,
  deletions: 74,
  url: 'https://github.com/waycool/CoolFocus/pull/10112',
};

// Shapes taken from the real rollup on waycool/CoolFocus#10112.
const ROLLUP = [
  { __typename: 'CheckRun', name: 'Validate Entity Sync', status: 'IN_PROGRESS', startedAt: '2026-07-31T20:08:45Z', completedAt: '0001-01-01T00:00:00Z', workflowName: 'Entity Sync', detailsUrl: 'https://x/1' },
  { __typename: 'CheckRun', name: 'Detect env var changes', status: 'COMPLETED', conclusion: 'SKIPPED', startedAt: '2026-07-31T20:08:36Z', completedAt: '2026-07-31T20:08:35Z' },
  { __typename: 'CheckRun', name: 'PR Gate / Detect Changes', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: '2026-07-31T20:08:46Z', completedAt: '2026-07-31T20:09:01Z' },
  { __typename: 'CheckRun', name: 'PR Gate / .NET Build', status: 'COMPLETED', conclusion: 'FAILURE', startedAt: '2026-07-31T20:08:46Z', completedAt: '2026-07-31T20:11:46Z' },
  { __typename: 'StatusContext', context: 'Vercel – coolfocus', state: 'PENDING', startedAt: '2026-07-31T20:08:31Z', targetUrl: 'https://vercel.com/x' },
];

test('an unfinished check has no duration, not a two-thousand-year one', () => {
  // GitHub reports completedAt as year zero for a running check.
  const d = normalizeCheckDetail(ROLLUP[0]);
  assert.equal(d.durationSeconds, null);
  assert.equal(d.state, 'pending');
});

test('a check that completed before it started reports no duration', () => {
  // Real data: the skipped check has completedAt one second before startedAt.
  assert.equal(normalizeCheckDetail(ROLLUP[1]).durationSeconds, null);
});

test('a completed check reports its duration in seconds', () => {
  assert.equal(normalizeCheckDetail(ROLLUP[2]).durationSeconds, 15);
  assert.equal(normalizeCheckDetail(ROLLUP[3]).durationSeconds, 180);
});

test('normalizeCheckDetail reads name and url from either shape', () => {
  assert.equal(normalizeCheckDetail(ROLLUP[0]).name, 'Validate Entity Sync');
  assert.equal(normalizeCheckDetail(ROLLUP[0]).url, 'https://x/1');
  assert.equal(normalizeCheckDetail(ROLLUP[4]).name, 'Vercel – coolfocus');
  assert.equal(normalizeCheckDetail(ROLLUP[4]).url, 'https://vercel.com/x');
  assert.equal(normalizeCheckDetail(ROLLUP[4]).state, 'pending');
});

test('checkDetails tolerates a missing rollup', () => {
  assert.deepEqual(checkDetails(null), []);
  assert.deepEqual(checkDetails(undefined), []);
});

test('formatDuration is compact across scales', () => {
  assert.equal(formatDuration(null), '');
  assert.equal(formatDuration(6), '6s');
  assert.equal(formatDuration(59), '59s');
  assert.equal(formatDuration(60), '1m');
  assert.equal(formatDuration(180), '3m');
  assert.equal(formatDuration(3600), '1h');
  assert.equal(formatDuration(3900), '1h5m');
});

test('groupChecks puts failures first and skipped last', () => {
  const groups = groupChecks(checkDetails(ROLLUP));
  assert.deepEqual(groups.map((g) => g.group.key), ['fail', 'pending', 'pass', 'neutral']);
  assert.equal(groups[0].items.length, 1);
  assert.equal(groups[1].items.length, 2, 'the running check and the pending status');
});

test('groupChecks omits empty groups', () => {
  const groups = groupChecks([{ name: 'a', state: 'pass', durationSeconds: 1 }]);
  assert.deepEqual(groups.map((g) => g.group.key), ['pass']);
});

test('group order is failure-first by definition', () => {
  assert.deepEqual(CHECK_GROUPS.map((g) => g.key), ['fail', 'pending', 'pass', 'neutral']);
});

test('renderChecks shows the PR header, groups and durations', () => {
  const out = renderChecksPlain({ space, pr, checks: checkDetails(ROLLUP), width: 40, style: 'compact' });
  assert.match(out, /WC-10207/);
  assert.match(out, /#10112/);
  assert.match(out, /\+42 -74/);
  assert.match(out, /Failed/);
  assert.match(out, /Running/);
  assert.match(out, /Passed/);
  assert.match(out, /Skipped/);
  assert.match(out, /3m/);
});

test('renderChecks fits a narrow pane without wrapping', () => {
  const out = renderChecksPlain({ space, pr, checks: checkDetails(ROLLUP), width: 32, style: 'compact' });
  for (const line of out.split('\n')) {
    assert.ok(line.length <= 34, `line too long (${line.length}): ${JSON.stringify(line)}`);
  }
});

test('renderChecks truncates a long check name with an ellipsis', () => {
  const long = [{ name: 'PR Gate / Entity Metadata Endpoint Guard With A Very Long Name', state: 'pass', durationSeconds: 6 }];
  const out = renderChecksPlain({ space, pr, checks: long, width: 32, style: 'compact' });
  assert.match(out, /…/);
});

test('renderChecks says so when the branch has no PR', () => {
  const out = renderChecksPlain({ space, pr: null, checks: [], width: 40 });
  assert.match(out, /No pull request/);
  assert.match(out, /wc-10207-catalog/);
});

test('renderChecks says so when nothing is focused', () => {
  assert.match(renderChecksPlain({ space: null, width: 40 }), /No space focused/);
});

test('renderChecks says so when a PR reports no checks at all', () => {
  const out = renderChecksPlain({ space, pr, checks: [], width: 40 });
  assert.match(out, /No checks reported/);
});

test('renderChecks shows the review decision when there is one', () => {
  const out = renderChecksPlain({ space, pr: { ...pr, review: 'CHANGES_REQUESTED' }, checks: [], width: 40 });
  assert.match(out, /changes requested/);
});

test('renderChecks emits no stray escapes', () => {
  const out = renderChecksPlain({ space, pr, checks: checkDetails(ROLLUP), width: 40 });
  assert.ok(!/\u001b/.test(out));
});

test('fetchPrChecks parses the object gh pr view returns, not an array', () => {
  const exec = () => ({
    status: 0,
    stdout: JSON.stringify({
      number: 10112,
      headRefName: 'wc-10207-catalog',
      state: 'OPEN',
      title: 't',
      additions: 42,
      deletions: 74,
      statusCheckRollup: ROLLUP,
    }),
    stderr: '',
  });
  const res = fetchPrChecks('waycool/CoolFocus', 10112, { exec });
  assert.equal(res.pr.number, 10112);
  assert.equal(res.pr.rolled, 'checks_failed');
  assert.equal(res.checks.length, 5);
});

test('fetchPrChecks returns null when gh fails', () => {
  assert.equal(fetchPrChecks('o/n', 1, { exec: () => ({ status: 1, stdout: '', stderr: 'no' }) }), null);
  assert.equal(fetchPrChecks('o/n', 1, { exec: () => ({ status: 0, stdout: 'junk', stderr: '' }) }), null);
});

test('every check row ends in the same column regardless of glyph', () => {
  // The emoji style mixes two-column glyphs with one-column ones. Padding on
  // string length alone made the duration column drift row to row.
  const mixed = [
    { name: 'a', state: 'fail', durationSeconds: 180 },
    { name: 'b', state: 'pending', durationSeconds: null },
    { name: 'c', state: 'pass', durationSeconds: 6 },
    { name: 'd', state: 'neutral', durationSeconds: null },
  ];
  for (const style of ['emoji', 'compact']) {
    const out = renderChecksPlain({ space, pr, checks: mixed, width: 40, style });
    const rows = out.split('\n').filter((l) => /^ \S+ [abcd]/.test(l));
    assert.equal(rows.length, 4, `expected four check rows in ${style}`);
    const widths = new Set(rows.map((r) => displayWidth(r)));
    assert.equal(widths.size, 1, `${style} rows ragged: ${[...widths].join(',')}`);
  }
});

test('the checks panel header labels a merged PR the same way the sidebar does', () => {
  const merged = { ...pr, rolled: 'merged' };
  assert.match(renderChecksPlain({ space, pr: merged, checks: [], width: 40 }), /#10112 MERGED/);
  assert.match(renderChecksPlain({ space, pr, checks: [], width: 40 }), /#10112 {2}\+/);
});
