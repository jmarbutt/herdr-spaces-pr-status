import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN_KEYS, stateGlyph, checksToken, reviewToken, diffToken, prTokens, clearedTokens } from '../lib/tokens.js';

const pr = (over = {}) => ({
  number: 10204,
  branch: 'wc-10203-onboarding',
  state: 'OPEN',
  isDraft: false,
  review: null,
  additions: 420,
  deletions: 37,
  url: 'https://github.com/waycool/CoolFocus/pull/10204',
  checks: { pass: 12, fail: 0, pending: 1, neutral: 3, relevant: 13, state: 'pending' },
  rolled: 'checks_pending',
  ...over,
});

test('stateGlyph covers every rolled-up state in both styles', () => {
  const states = ['merged', 'closed', 'draft', 'checks_failed', 'checks_pending', 'open'];
  const emoji = states.map((s) => stateGlyph(s, 'emoji'));
  const compact = states.map((s) => stateGlyph(s, 'compact'));
  assert.equal(new Set(emoji).size, states.length, 'emoji glyphs must be distinguishable');
  assert.equal(new Set(compact).size, states.length, 'compact glyphs must be distinguishable');
  for (const g of [...emoji, ...compact]) assert.ok(g.length > 0);
});

test('stateGlyph falls back to the open glyph for an unknown state', () => {
  assert.equal(stateGlyph('nonsense', 'emoji'), stateGlyph('open', 'emoji'));
});

test('stateGlyph defaults to compact for an unknown style', () => {
  // compact is the default because emoji beside herdr's single-width state
  // icons read as oversized.
  assert.equal(stateGlyph('merged', 'klingon'), stateGlyph('merged', 'compact'));
  assert.equal(stateGlyph('merged', undefined), stateGlyph('merged', 'compact'));
});

test('checksToken reports failures as failed-over-relevant', () => {
  const t = checksToken({ pass: 12, fail: 2, pending: 0, neutral: 3, relevant: 14, state: 'fail' }, 'compact');
  assert.match(t, /2\/14/);
});

test('checksToken reports passes and pending as passed-over-relevant', () => {
  assert.match(checksToken({ pass: 12, fail: 0, pending: 0, neutral: 0, relevant: 12, state: 'pass' }, 'compact'), /12\/12/);
  assert.match(checksToken({ pass: 5, fail: 0, pending: 8, neutral: 0, relevant: 13, state: 'pending' }, 'compact'), /5\/13/);
});

test('checksToken is null when there is nothing meaningful to report', () => {
  assert.equal(checksToken({ pass: 0, fail: 0, pending: 0, neutral: 4, relevant: 0, state: 'none' }, 'emoji'), null);
  assert.equal(checksToken(null, 'emoji'), null);
});

test('reviewToken maps GitHub review decisions to short labels', () => {
  assert.equal(reviewToken('APPROVED'), 'approved');
  assert.equal(reviewToken('CHANGES_REQUESTED'), 'changes req');
  assert.equal(reviewToken('REVIEW_REQUIRED'), 'review req');
  assert.equal(reviewToken(null), null);
  assert.equal(reviewToken(''), null);
});

test('reviewToken passes through an unrecognised decision lowercased', () => {
  assert.equal(reviewToken('SOMETHING_NEW'), 'something new');
});

test('diffToken formats additions and deletions', () => {
  assert.equal(diffToken({ additions: 420, deletions: 37 }), '+420 -37');
  assert.equal(diffToken({ additions: 0, deletions: 0 }), '+0 -0');
});

test('prTokens produces the full token map for an open PR', () => {
  const t = prTokens(pr({ review: 'APPROVED' }), 'compact');
  assert.deepEqual(Object.keys(t).sort(), [...TOKEN_KEYS].sort());
  assert.match(t.pr, /10204/);
  assert.match(t.pr_checks, /12\/13/);
  assert.equal(t.pr_review, 'approved');
  assert.equal(t.pr_diff, '+420 -37');
});

test('prTokens nulls the tokens that do not apply rather than omitting them', () => {
  // Omitting a key leaves the previous value in place; null is what clears it.
  const t = prTokens(pr({ review: null, checks: { pass: 0, fail: 0, pending: 0, neutral: 0, relevant: 0, state: 'none' } }), 'emoji');
  assert.equal(t.pr_review, null);
  assert.equal(t.pr_checks, null);
  assert.ok(t.pr);
});

test('prTokens on a merged PR shows the merged glyph and drops checks', () => {
  const t = prTokens(pr({ state: 'MERGED', rolled: 'merged' }), 'emoji');
  assert.ok(t.pr.includes(stateGlyph('merged', 'emoji')));
  assert.match(t.pr, /#10204/);
  // A merged PR's check history is noise.
  assert.equal(t.pr_checks, null);
});

test('prTokens on a closed PR drops checks and review', () => {
  const t = prTokens(pr({ state: 'CLOSED', rolled: 'closed', review: 'APPROVED' }), 'emoji');
  assert.equal(t.pr_checks, null);
  assert.equal(t.pr_review, null);
});

test('clearedTokens nulls every key so a space with no PR shows nothing', () => {
  const t = clearedTokens();
  assert.deepEqual(Object.keys(t).sort(), [...TOKEN_KEYS].sort());
  for (const v of Object.values(t)) assert.equal(v, null);
});

test('every token value stays inside the 80 character herdr cap', () => {
  const brutal = pr({
    number: 999999999,
    review: 'CHANGES_REQUESTED',
    additions: 987654321,
    deletions: 123456789,
    checks: { pass: 998, fail: 997, pending: 996, neutral: 0, relevant: 2991, state: 'fail' },
  });
  for (const style of ['emoji', 'compact']) {
    for (const [k, v] of Object.entries(prTokens(brutal, style))) {
      if (v !== null) assert.ok(v.length <= 80, `${style}/${k} is ${v.length} chars`);
    }
  }
});

test('token values contain no control characters', () => {
  // herdr strips control characters, so anything sneaking in would be dropped
  // silently rather than rendered.
  for (const style of ['emoji', 'compact']) {
    for (const v of Object.values(prTokens(pr({ review: 'APPROVED' }), style))) {
      if (v !== null) assert.ok(!/[\u0000-\u001f\u007f]/.test(v), `control char in ${JSON.stringify(v)}`);
    }
  }
});

test('token keys match the documented names so config rows stay stable', () => {
  assert.deepEqual([...TOKEN_KEYS], ['pr', 'pr_checks', 'pr_review', 'pr_diff']);
});

test('a merged PR says so, because the glyph alone does not', () => {
  const t = prTokens(pr({ state: 'MERGED', rolled: 'merged' }), 'compact');
  assert.match(t.pr, /#10204 MERGED$/);
});

test('closed and draft are labelled too, for the same reason', () => {
  assert.match(prTokens(pr({ state: 'CLOSED', rolled: 'closed' }), 'compact').pr, /#10204 CLOSED$/);
  assert.match(prTokens(pr({ isDraft: true, rolled: 'draft' }), 'compact').pr, /#10204 DRAFT$/);
});

test('active states carry no label, because the checks token already explains them', () => {
  // "● #10110 · ✓ 28/28" needs no word; "◆ #10105" does.
  for (const rolled of ['open', 'checks_failed', 'checks_pending']) {
    assert.match(prTokens(pr({ rolled }), 'compact').pr, /^\S+ #10204$/);
  }
});

test('labels appear in both styles', () => {
  for (const style of ['emoji', 'compact']) {
    assert.match(prTokens(pr({ state: 'MERGED', rolled: 'merged' }), style).pr, /MERGED/);
  }
});
