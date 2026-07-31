import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayWidth, padTo, truncateTo } from '../lib/width.js';

test('ascii is one column per character', () => {
  assert.equal(displayWidth(''), 0);
  assert.equal(displayWidth('PR Gate'), 7);
});

test('emoji are two columns even when they are one code unit', () => {
  // The whole reason this module exists: these two look identical in width on
  // screen but differ in .length, so .length-based padding drifts.
  assert.equal('🟢'.length, 2);
  assert.equal('⚪'.length, 1);
  assert.equal(displayWidth('🟢'), 2);
  assert.equal(displayWidth('⚪'), 2);
  assert.equal(displayWidth('⚫'), 2);
  assert.equal(displayWidth('🟣'), 2);
  assert.equal(displayWidth('🔴'), 2);
  assert.equal(displayWidth('🟡'), 2);
});

test('the compact glyph set is single-width', () => {
  for (const g of ['●', '◐', '⊗', '◌', '◆', '⊘', '✓', '✗', '…', '·']) {
    assert.equal(displayWidth(g), 1, `${g} should be one column`);
  }
});

test('CJK is two columns per character', () => {
  assert.equal(displayWidth('日本語'), 6);
});

test('a variation selector adds no width of its own', () => {
  assert.equal(displayWidth('⚪️'), 2);
});

test('padTo fills to an exact column count', () => {
  assert.equal(displayWidth(padTo('abc', 10)), 10);
  assert.equal(displayWidth(padTo('', 10)), 10);
});

test('padTo gives every glyph style the same rendered width', () => {
  // This is the bug it fixes: a column of mixed emoji used to end ragged.
  for (const g of ['🟢', '⚪', '⚫', '●', '✓']) {
    assert.equal(displayWidth(padTo(`${g} name`, 20)), 20, `${g} row misaligned`);
  }
});

test('padTo truncates with an ellipsis and still lands on the exact width', () => {
  const out = padTo('PR Gate / Entity Metadata Endpoint Guard', 20);
  assert.equal(displayWidth(out), 20);
  assert.match(out, /…/);
});

test('padTo never splits a surrogate pair', () => {
  const out = padTo('🟢🟢🟢🟢🟢', 5);
  assert.equal(displayWidth(out), 5);
  assert.ok(!out.includes('�'));
  for (const ch of out) assert.ok(ch.codePointAt(0) !== 0xd83d || ch.length === 2);
});

test('truncateTo respects a column budget', () => {
  assert.equal(truncateTo('abcdef', 3), 'abc');
  assert.equal(truncateTo('🟢🟢🟢', 4), '🟢🟢');
  // Half an emoji does not fit, so it is dropped entirely.
  assert.equal(truncateTo('🟢🟢🟢', 3), '🟢');
  assert.equal(truncateTo('abc', 0), '');
});

test('displayWidth ignores control characters', () => {
  assert.equal(displayWidth('a\u0007b'), 2);
});
