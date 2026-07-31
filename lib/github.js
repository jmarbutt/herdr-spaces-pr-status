import { runCmd } from './exec.js';

// `gh pr list --json statusCheckRollup` returns a heterogeneous array. Checks
// from GitHub Actions arrive as CheckRun (status + conclusion); commit statuses
// posted by third parties like Vercel arrive as StatusContext (state). Handling
// only one shape silently drops half the signal.
const CHECK_RUN_FAIL = new Set(['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE', 'ACTION_REQUIRED']);
const CHECK_RUN_NEUTRAL = new Set(['SKIPPED', 'CANCELLED', 'NEUTRAL', 'STALE']);
const STATUS_FAIL = new Set(['FAILURE', 'ERROR']);

const JSON_FIELDS = [
  'number',
  'headRefName',
  'state',
  'isDraft',
  'reviewDecision',
  'statusCheckRollup',
  'additions',
  'deletions',
  'url',
  'title',
];

// git@host:owner/name.git | https://host/owner/name(.git) | ssh://git@host/owner/name.git
export function parseRemoteUrl(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  const scp = /^(?:[^@/]+@)?([^:/]+):([^/]+)\/(.+?)(?:\.git)?$/.exec(trimmed);
  const uri = /^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(trimmed);
  const m = trimmed.includes('://') ? uri : scp;
  if (!m) return null;

  const [, host, owner, name] = m;
  // A path like /Users/jonathan/repo has no host segment worth trusting.
  if (!host.includes('.') || !owner || !name || name.includes('/')) return null;
  return { host, owner, name };
}

export function normalizeCheck(check) {
  if (!check || typeof check !== 'object') return 'neutral';
  if (check.__typename === 'CheckRun') {
    if (check.status !== 'COMPLETED') return 'pending';
    if (check.conclusion === 'SUCCESS') return 'pass';
    if (CHECK_RUN_FAIL.has(check.conclusion)) return 'fail';
    if (CHECK_RUN_NEUTRAL.has(check.conclusion)) return 'neutral';
    return 'neutral';
  }
  if (check.__typename === 'StatusContext') {
    if (check.state === 'SUCCESS') return 'pass';
    if (STATUS_FAIL.has(check.state)) return 'fail';
    return 'pending';
  }
  return 'neutral';
}

// `relevant` deliberately excludes neutral checks: this repo skips a lot of
// workflows per PR, and counting them would turn "everything green" into
// something like 12/28.
export function summarizeChecks(rollup) {
  const counts = { pass: 0, fail: 0, pending: 0, neutral: 0 };
  for (const check of Array.isArray(rollup) ? rollup : []) {
    counts[normalizeCheck(check)] += 1;
  }
  const relevant = counts.pass + counts.fail + counts.pending;
  let state = 'none';
  if (counts.fail > 0) state = 'fail';
  else if (counts.pending > 0) state = 'pending';
  else if (counts.pass > 0) state = 'pass';
  return { ...counts, relevant, state };
}

export function rollupPrState(pr) {
  if (pr.state === 'MERGED') return 'merged';
  if (pr.state === 'CLOSED') return 'closed';
  if (pr.isDraft) return 'draft';
  const checks = pr.checks?.state;
  if (checks === 'fail') return 'checks_failed';
  if (checks === 'pending') return 'checks_pending';
  return 'open';
}

export function normalizePr(raw) {
  const checks = summarizeChecks(raw.statusCheckRollup);
  const pr = {
    number: raw.number,
    branch: raw.headRefName,
    title: raw.title ?? null,
    state: raw.state,
    isDraft: Boolean(raw.isDraft),
    review: raw.reviewDecision || null,
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    url: raw.url ?? null,
    checks,
  };
  pr.rolled = rollupPrState(pr);
  return pr;
}

export function prListArgs({ repo, branch, limit = 100 }) {
  const args = ['pr', 'list', '--repo', repo];
  if (branch) args.push('--head', branch, '--state', 'all');
  else args.push('--state', 'open');
  args.push('--limit', String(limit), '--json', JSON_FIELDS.join(','));
  return args;
}

function ghJson(args, { exec = runCmd, ghPath = 'gh' } = {}) {
  const res = exec(ghPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.status !== 0) return { ok: false, data: [], error: res.stderr.trim() };
  try {
    const data = JSON.parse(res.stdout);
    return { ok: true, data: Array.isArray(data) ? data : [], error: null };
  } catch (err) {
    return { ok: false, data: [], error: String(err.message) };
  }
}

// One call per repo covers every open PR. Callers fall back to fetchBranchPr
// only for branches that miss here.
export function fetchOpenPrs(repo, opts = {}) {
  const { data } = ghJson(prListArgs({ repo, limit: opts.limit ?? 100 }), opts);
  const byBranch = new Map();
  for (const raw of data) {
    if (raw?.headRefName) byBranch.set(raw.headRefName, normalizePr(raw));
  }
  return byBranch;
}

export function fetchBranchPr(repo, branch, opts = {}) {
  const { data } = ghJson(prListArgs({ repo, branch, limit: 1 }), opts);
  return data.length > 0 ? normalizePr(data[0]) : null;
}
