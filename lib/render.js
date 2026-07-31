import { stateGlyph } from './tokens.js';
import { padTo, displayWidth } from './width.js';

// Conductor's History panel groups work by where it stands, not by repo. That
// grouping is the part worth stealing: at a glance you see what is waiting on
// you. herdr owns the sidebar's ordering, so this is where grouping lives.
export const GROUPS = [
  { key: 'checks_failed', title: 'Checks failing' },
  { key: 'open', title: 'In review' },
  { key: 'checks_pending', title: 'Checks running' },
  { key: 'draft', title: 'Draft' },
  { key: 'merged', title: 'Merged' },
  { key: 'closed', title: 'Closed' },
  { key: 'none', title: 'No pull request' },
];

const ESC = '\u001b';
const DIM = `${ESC}[2m`;
const BOLD = `${ESC}[1m`;
const REVERSE = `${ESC}[7m`;
const RESET = `${ESC}[0m`;

// Rows are what the arrow keys move between; headers are skipped.
export function buildRows(spaces) {
  const byState = new Map(GROUPS.map((g) => [g.key, []]));
  for (const entry of spaces) {
    const key = entry.pr?.rolled ?? 'none';
    (byState.get(key) ?? byState.get('none')).push(entry);
  }

  const rows = [];
  for (const group of GROUPS) {
    const items = byState.get(group.key) ?? [];
    if (items.length === 0) continue;
    items.sort((a, b) => (a.space.label || '').localeCompare(b.space.label || ''));
    rows.push({ type: 'header', group, count: items.length });
    for (const item of items) rows.push({ type: 'item', group, ...item });
  }
  return rows;
}

export function selectableIndexes(rows) {
  return rows.flatMap((r, i) => (r.type === 'item' ? [i] : []));
}

function diffOf(pr) {
  return pr ? `+${pr.additions ?? 0} -${pr.deletions ?? 0}` : '';
}

function itemLine(row, width, style) {
  const { pr, space } = row;
  const glyph = pr ? stateGlyph(pr.rolled, style) : ' ';
  const number = pr ? `#${pr.number}` : '';
  const diff = diffOf(pr);
  const review = pr?.review === 'APPROVED' ? 'approved' : pr?.review === 'CHANGES_REQUESTED' ? 'changes req' : '';

  const right = diff ? ` ${diff}` : '';
  const left = `   ${glyph} ${padTo(space.label, 14)} ${padTo(number, 8)} ${review}`;
  const room = Math.max(0, width - displayWidth(right));
  return padTo(left, room) + right;
}

export function renderBoard({
  spaces = [],
  width = 80,
  selected = 0,
  style = 'emoji',
  status = '',
} = {}) {
  const rows = buildRows(spaces);
  const lines = [];

  const title = `${BOLD}Pull requests${RESET}`;
  const count = `${spaces.length} space${spaces.length === 1 ? '' : 's'}`;
  lines.push(` ${title}${' '.repeat(Math.max(1, width - 16 - count.length))}${DIM}${count}${RESET}`);
  lines.push('');

  if (rows.length === 0) {
    lines.push(`${DIM}   No spaces with a resolvable GitHub branch.${RESET}`);
  }

  for (const [i, row] of rows.entries()) {
    if (row.type === 'header') {
      const label = padTo(row.group.title, width - 6);
      lines.push(` ${BOLD}${label}${RESET}${DIM}${String(row.count).padStart(3)}${RESET}`);
      continue;
    }
    const text = itemLine(row, width - 2, style);
    lines.push(i === selected ? `${REVERSE}${text}${RESET}` : text);
  }

  lines.push('');
  const help = '↑↓ move · enter focus space · o open PR · r refresh · q quit';
  lines.push(`${DIM} ${status ? `${status} · ` : ''}${help}${RESET}`);
  return lines.join('\n');
}

// Plain text for tests and for anything that wants the board without escapes.
export function renderPlain(opts) {
  // eslint-disable-next-line no-control-regex
  return renderBoard(opts).replace(/\u001b\[[0-9;]*m/g, '');
}
