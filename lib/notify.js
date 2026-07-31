import { reviewToken } from './tokens.js';

// Notifications only fire on a transition we can prove happened: both cycles
// saw the same PR on the same space, and something crossed a line. Anything
// weaker produces a toast every restart, which trains you to ignore them.
export function diffNotifications(previous, current, { notify = [], firstCycle = false } = {}) {
  if (firstCycle || notify.length === 0) return [];
  const wanted = new Set(notify);
  const out = [];

  for (const [workspaceId, entry] of Object.entries(current ?? {})) {
    const pr = entry?.pr;
    const before = previous?.[workspaceId]?.pr;
    // No baseline, no PR now, or a different PR entirely: nothing to compare.
    if (!pr || !before || before.number !== pr.number) continue;

    const label = entry.space?.label || workspaceId;
    const push = (kind, body) => out.push({ kind, workspaceId, label, url: pr.url ?? null, title: label, body });

    if (wanted.has('checks_failed') && pr.rolled === 'checks_failed' && before.rolled !== 'checks_failed') {
      push('checks_failed', `#${pr.number} checks failed`);
    }
    if (wanted.has('review') && pr.review && pr.review !== before.review) {
      push('review', `#${pr.number} ${reviewToken(pr.review)}`);
    }
    if (wanted.has('merged') && pr.rolled === 'merged' && before.rolled !== 'merged') {
      push('merged', `#${pr.number} merged`);
    }
  }
  return out;
}
