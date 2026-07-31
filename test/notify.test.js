import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffNotifications } from '../lib/notify.js';

const ALL = ['checks_failed', 'review', 'merged'];

const space = (over = {}) => ({ workspace_id: 'w69', label: 'WC-10200', ...over });

const pr = (over = {}) => ({
  number: 10204,
  rolled: 'open',
  review: null,
  checks: { state: 'pass' },
  url: 'https://github.com/waycool/CoolFocus/pull/10204',
  ...over,
});

test('the first cycle notifies nothing, because everything looks new', () => {
  // A daemon restart must not fire a toast for every PR you already knew about.
  const current = { w69: { space: space(), pr: pr({ rolled: 'checks_failed' }) } };
  assert.deepEqual(diffNotifications({}, current, { notify: ALL, firstCycle: true }), []);
});

test('checks going green to red notifies', () => {
  const prev = { w69: { space: space(), pr: pr({ rolled: 'open' }) } };
  const next = { w69: { space: space(), pr: pr({ rolled: 'checks_failed' }) } };
  const out = diffNotifications(prev, next, { notify: ALL });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'checks_failed');
  assert.match(out[0].title, /WC-10200/);
  assert.match(out[0].body, /#10204/);
});

test('checks staying red does not re-notify every poll', () => {
  const prev = { w69: { space: space(), pr: pr({ rolled: 'checks_failed' }) } };
  const next = { w69: { space: space(), pr: pr({ rolled: 'checks_failed' }) } };
  assert.deepEqual(diffNotifications(prev, next, { notify: ALL }), []);
});

test('checks recovering from red does not notify', () => {
  const prev = { w69: { space: space(), pr: pr({ rolled: 'checks_failed' }) } };
  const next = { w69: { space: space(), pr: pr({ rolled: 'open' }) } };
  assert.deepEqual(diffNotifications(prev, next, { notify: ALL }), []);
});

test('a new review decision notifies once', () => {
  const prev = { w69: { space: space(), pr: pr({ review: null }) } };
  const next = { w69: { space: space(), pr: pr({ review: 'APPROVED' }) } };
  const out = diffNotifications(prev, next, { notify: ALL });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'review');
  assert.match(out[0].body, /approved/i);

  const same = diffNotifications(next, next, { notify: ALL });
  assert.deepEqual(same, []);
});

test('changing review decision notifies again', () => {
  const prev = { w69: { space: space(), pr: pr({ review: 'APPROVED' }) } };
  const next = { w69: { space: space(), pr: pr({ review: 'CHANGES_REQUESTED' }) } };
  const out = diffNotifications(prev, next, { notify: ALL });
  assert.equal(out.length, 1);
  assert.match(out[0].body, /changes req/i);
});

test('a merge notifies once', () => {
  const prev = { w69: { space: space(), pr: pr({ rolled: 'open' }) } };
  const next = { w69: { space: space(), pr: pr({ rolled: 'merged' }) } };
  const out = diffNotifications(prev, next, { notify: ALL });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'merged');
});

test('notify classes are opt-in', () => {
  const prev = { w69: { space: space(), pr: pr({ rolled: 'open', review: null }) } };
  const next = {
    w69: { space: space(), pr: pr({ rolled: 'checks_failed', review: 'APPROVED' }) },
  };
  const only = diffNotifications(prev, next, { notify: ['review'] });
  assert.deepEqual(only.map((n) => n.kind), ['review']);
  assert.deepEqual(diffNotifications(prev, next, { notify: [] }), []);
});

test('a space that gains its first PR does not notify', () => {
  // Opening a PR is something you just did; you do not need telling.
  const prev = { w69: { space: space(), pr: null } };
  const next = { w69: { space: space(), pr: pr({ rolled: 'checks_failed' }) } };
  assert.deepEqual(diffNotifications(prev, next, { notify: ALL }), []);
});

test('a space with no previous entry does not notify', () => {
  const next = { w6A: { space: space({ workspace_id: 'w6A' }), pr: pr({ rolled: 'merged' }) } };
  assert.deepEqual(diffNotifications({}, next, { notify: ALL }), []);
});

test('a space that loses its PR does not notify', () => {
  const prev = { w69: { space: space(), pr: pr({ rolled: 'open' }) } };
  const next = { w69: { space: space(), pr: null } };
  assert.deepEqual(diffNotifications(prev, next, { notify: ALL }), []);
});

test('a different PR number on the same space is treated as new, not changed', () => {
  // Force-pushing a branch into a fresh PR should not fire a stale-looking toast.
  const prev = { w69: { space: space(), pr: pr({ number: 1, rolled: 'open' }) } };
  const next = { w69: { space: space(), pr: pr({ number: 2, rolled: 'checks_failed' }) } };
  assert.deepEqual(diffNotifications(prev, next, { notify: ALL }), []);
});

test('several spaces each notify independently', () => {
  const prev = {
    w69: { space: space(), pr: pr({ rolled: 'open' }) },
    w6A: { space: space({ workspace_id: 'w6A', label: 'WC-10203' }), pr: pr({ number: 9, rolled: 'open' }) },
  };
  const next = {
    w69: { space: space(), pr: pr({ rolled: 'checks_failed' }) },
    w6A: { space: space({ workspace_id: 'w6A', label: 'WC-10203' }), pr: pr({ number: 9, rolled: 'merged' }) },
  };
  const out = diffNotifications(prev, next, { notify: ALL });
  assert.deepEqual(out.map((n) => n.kind).sort(), ['checks_failed', 'merged']);
});

test('notifications carry the PR url so the toast can be actioned', () => {
  const prev = { w69: { space: space(), pr: pr({ rolled: 'open' }) } };
  const next = { w69: { space: space(), pr: pr({ rolled: 'merged' }) } };
  assert.equal(diffNotifications(prev, next, { notify: ALL })[0].url, pr().url);
});
