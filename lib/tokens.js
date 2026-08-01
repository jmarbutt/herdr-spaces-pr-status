// herdr caps token values at 80 characters and strips control characters
// before storage, so a token can carry no ANSI colour of its own. Per-value
// colour has to come from the glyph itself, which is why the emoji style
// exists.
//
// Emoji are double-width: on a default 26-column sidebar every glyph costs two
// cells that the branch name wanted. The compact style trades colour for
// single-width symbols in the same visual language herdr already uses for
// agent state.
export const TOKEN_KEYS = ['pr', 'pr_checks', 'pr_review', 'pr_diff'];

export const STYLES = ['emoji', 'compact'];

const MAX_TOKEN_LENGTH = 80;

const GLYPHS = {
  emoji: {
    merged: '\u{1F7E3}', // purple circle
    closed: '\u{26AB}', // black circle
    draft: '\u{26AA}', // white circle
    checks_failed: '\u{1F534}', // red circle
    checks_pending: '\u{1F7E1}', // yellow circle
    open: '\u{1F7E2}', // green circle
  },
  // Shapes, not check marks: the PR-state glyph and the check-count marker are
  // different dimensions and should not share a symbol.
  compact: {
    merged: '◆',
    closed: '⊘',
    draft: '◌',
    checks_failed: '⊗',
    checks_pending: '◐',
    open: '●',
  },
};

const CHECK_MARKS = {
  emoji: { fail: '✗', pending: '⏳', pass: '✓' },
  compact: { fail: '✗', pending: '…', pass: '✓' },
};

const REVIEW_LABELS = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes req',
  REVIEW_REQUIRED: 'review req',
};

// Once a PR is merged or closed, its check history and review state are
// history too. Showing them just competes with the states that still matter.
const TERMINAL_STATES = new Set(['merged', 'closed']);

// Only for the states where nothing else on the row explains what happened.
// "● #10110 · ✓ 28/28" is self-evident; "◆ #10105" is a shape you have to
// remember, so it gets a word.
const STATE_LABELS = {
  merged: 'MERGED',
  closed: 'CLOSED',
  draft: 'DRAFT',
};

export function stateLabel(state) {
  return STATE_LABELS[state] ?? null;
}

function styleOf(style) {
  return style === 'emoji' ? 'emoji' : 'compact';
}

function cap(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.length > MAX_TOKEN_LENGTH ? text.slice(0, MAX_TOKEN_LENGTH) : text;
}

export function stateGlyph(state, style) {
  const set = GLYPHS[styleOf(style)];
  return set[state] ?? set.open;
}

export function checksToken(checks, style) {
  if (!checks || checks.state === 'none' || checks.relevant === 0) return null;
  const marks = CHECK_MARKS[styleOf(style)];
  const numerator = checks.state === 'fail' ? checks.fail : checks.pass;
  return cap(`${marks[checks.state]} ${numerator}/${checks.relevant}`);
}

export function reviewToken(review) {
  if (!review) return null;
  return cap(REVIEW_LABELS[review] ?? review.toLowerCase().replace(/_/g, ' '));
}

export function diffToken(pr) {
  return cap(`+${pr.additions ?? 0} -${pr.deletions ?? 0}`);
}

export function prTokens(pr, style) {
  const terminal = TERMINAL_STATES.has(pr.rolled);
  const label = stateLabel(pr.rolled);
  return {
    pr: cap(`${stateGlyph(pr.rolled, style)} #${pr.number}${label ? ` ${label}` : ''}`),
    pr_checks: terminal ? null : checksToken(pr.checks, style),
    pr_review: terminal ? null : reviewToken(pr.review),
    pr_diff: diffToken(pr),
  };
}

// Omitting a key leaves herdr's previous value untouched, so a space that lost
// its PR has to be cleared explicitly with nulls.
export function clearedTokens() {
  return Object.fromEntries(TOKEN_KEYS.map((k) => [k, null]));
}
