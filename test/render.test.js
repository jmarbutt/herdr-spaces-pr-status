import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRows, selectableIndexes, renderPlain, GROUPS } from '../lib/render.js';

const entry = (label, pr) => ({ space: { workspace_id: `w-${label}`, label }, pr });

const pr = (over = {}) => ({
  number: 1,
  rolled: 'open',
  review: null,
  additions: 10,
  deletions: 2,
  url: 'https://github.com/o/n/pull/1',
  ...over,
});

const SPACES = [
  entry('WC-10202', pr({ number: 10110, rolled: 'checks_failed', additions: 914, deletions: 46 })),
  entry('WC-10203', pr({ number: 10109, rolled: 'merged', additions: 489, deletions: 11 })),
  entry('WC-10200', pr({ number: 10105, rolled: 'merged', additions: 173, deletions: 5 })),
  entry('WC-10195', null),
  entry('WC-10207', null),
  entry('WC-10192', pr({ number: 10111, rolled: 'open', review: 'APPROVED' })),
];

test('buildRows groups by rolled-up PR state', () => {
  const rows = buildRows(SPACES);
  const headers = rows.filter((r) => r.type === 'header').map((r) => [r.group.title, r.count]);
  assert.deepEqual(headers, [
    ['Checks failing', 1],
    ['In review', 1],
    ['Merged', 2],
    ['No pull request', 2],
  ]);
});

test('buildRows omits empty groups entirely', () => {
  const rows = buildRows([entry('A', pr({ rolled: 'merged' }))]);
  assert.deepEqual(rows.filter((r) => r.type === 'header').map((r) => r.group.key), ['merged']);
});

test('buildRows orders groups so what needs attention comes first', () => {
  const order = GROUPS.map((g) => g.key);
  assert.equal(order[0], 'checks_failed');
  assert.ok(order.indexOf('merged') > order.indexOf('open'));
  assert.equal(order.at(-1), 'none');
});

test('buildRows sorts items inside a group by label', () => {
  const rows = buildRows(SPACES);
  const merged = rows.filter((r) => r.type === 'item' && r.group.key === 'merged');
  assert.deepEqual(merged.map((r) => r.space.label), ['WC-10200', 'WC-10203']);
});

test('spaces with no PR land in the no-pull-request group', () => {
  const rows = buildRows(SPACES);
  const none = rows.filter((r) => r.type === 'item' && r.group.key === 'none');
  assert.deepEqual(none.map((r) => r.space.label), ['WC-10195', 'WC-10207']);
});

test('selectableIndexes skips headers so arrow keys never land on one', () => {
  const rows = buildRows(SPACES);
  const idx = selectableIndexes(rows);
  assert.equal(idx.length, SPACES.length);
  for (const i of idx) assert.equal(rows[i].type, 'item');
});

test('buildRows handles an empty space list', () => {
  assert.deepEqual(buildRows([]), []);
  assert.deepEqual(selectableIndexes([]), []);
});

test('renderPlain shows group titles, counts, PR numbers and diff stats', () => {
  const out = renderPlain({ spaces: SPACES, width: 78, style: 'compact' });
  assert.match(out, /Pull requests/);
  assert.match(out, /Checks failing/);
  assert.match(out, /#10110/);
  assert.match(out, /\+914 -46/);
  assert.match(out, /approved/);
  assert.match(out, /6 spaces/);
});

test('renderPlain includes the key help', () => {
  const out = renderPlain({ spaces: SPACES, width: 78 });
  assert.match(out, /enter focus space/);
  assert.match(out, /o open PR/);
  assert.match(out, /q quit/);
});

test('renderPlain shows a status message when one is given', () => {
  const out = renderPlain({ spaces: SPACES, width: 78, status: 'refreshing' });
  assert.match(out, /refreshing/);
});

test('renderPlain says something useful when there is nothing to show', () => {
  const out = renderPlain({ spaces: [], width: 78 });
  assert.match(out, /No spaces/);
});

test('renderPlain emits no stray escape sequences', () => {
  const out = renderPlain({ spaces: SPACES, width: 78 });
  assert.ok(!/\u001b/.test(out));
});

test('rendered lines stay within the requested width', () => {
  const out = renderPlain({ spaces: SPACES, width: 60, style: 'compact' });
  for (const line of out.split('\n')) {
    assert.ok(line.length <= 62, `line too long (${line.length}): ${JSON.stringify(line)}`);
  }
});

test('a very long space label is truncated rather than wrapping', () => {
  const long = entry('a-really-very-long-space-label-that-goes-on', pr());
  const out = renderPlain({ spaces: [long], width: 60, style: 'compact' });
  for (const line of out.split('\n')) assert.ok(line.length <= 62);
});
