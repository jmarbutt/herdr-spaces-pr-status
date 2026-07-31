import { stateGlyph } from './tokens.js';
import { padTo, displayWidth } from './width.js';

const ESC = '\u001b';
const DIM = `${ESC}[2m`;
const BOLD = `${ESC}[1m`;
const RESET = `${ESC}[0m`;

// Grouped by what you can act on, not by provider. With a dozen checks the
// question is always "is anything broken and is anything still running",
// and provider grouping answers neither.
export const CHECK_GROUPS = [
  { key: 'fail', title: 'Failed' },
  { key: 'pending', title: 'Running' },
  { key: 'pass', title: 'Passed' },
  { key: 'neutral', title: 'Skipped' },
];

const MARKS = {
  emoji: { fail: '🔴', pending: '🟡', pass: '🟢', neutral: '⚪' },
  compact: { fail: '✗', pending: '◐', pass: '✓', neutral: '·' },
};

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60 ? `${m % 60}m` : ''}`;
}

export function groupChecks(checks) {
  const out = [];
  for (const group of CHECK_GROUPS) {
    const items = (checks ?? []).filter((c) => c.state === group.key);
    if (items.length === 0) continue;
    items.sort((a, b) => a.name.localeCompare(b.name));
    out.push({ group, items });
  }
  return out;
}

export function renderChecks({
  space = null,
  pr = null,
  checks = [],
  width = 40,
  style = 'emoji',
  status = '',
} = {}) {
  const marks = MARKS[style === 'compact' ? 'compact' : 'emoji'];
  const lines = [];
  const inner = Math.max(16, width - 2);

  if (!space) {
    lines.push(`${DIM} No space focused.${RESET}`);
    return lines.join('\n');
  }

  lines.push(` ${BOLD}${padTo(space.label, inner - 1)}${RESET}`);

  if (!pr) {
    lines.push(`${DIM} ${padTo(space.branch ?? '', inner - 1)}${RESET}`);
    lines.push('');
    lines.push(`${DIM} No pull request for this branch.${RESET}`);
    lines.push('');
    lines.push(`${DIM} r refresh · q close${RESET}`);
    return lines.join('\n');
  }

  const head = `${stateGlyph(pr.rolled, style)} #${pr.number}  +${pr.additions} -${pr.deletions}`;
  lines.push(` ${head}`);
  if (pr.title) lines.push(`${DIM} ${padTo(pr.title, inner - 1)}${RESET}`);
  if (pr.review) {
    const label = pr.review === 'APPROVED' ? 'approved' : pr.review === 'CHANGES_REQUESTED' ? 'changes requested' : 'review required';
    lines.push(`${DIM} ${label}${RESET}`);
  }
  lines.push('');

  const groups = groupChecks(checks);
  if (groups.length === 0) {
    lines.push(`${DIM} No checks reported.${RESET}`);
  }

  for (const { group, items } of groups) {
    lines.push(` ${BOLD}${group.title}${RESET}${DIM} ${items.length}${RESET}`);
    for (const item of items) {
      const time = formatDuration(item.durationSeconds);
      // The glyph is two columns in the emoji style and one in compact, so
      // the name budget has to be measured, not assumed.
      const glyphWidth = displayWidth(marks[item.state]);
      const nameWidth = Math.max(8, inner - glyphWidth - 2 - time.length);
      lines.push(` ${marks[item.state]} ${padTo(item.name, nameWidth)}${DIM}${time}${RESET}`);
    }
    lines.push('');
  }

  lines.push(`${DIM} ${status ? `${status} · ` : ''}r refresh · o open · q close${RESET}`);
  return lines.join('\n');
}

export function renderChecksPlain(opts) {
  return renderChecks(opts).replace(/\u001b\[[0-9;]*m/g, '');
}
