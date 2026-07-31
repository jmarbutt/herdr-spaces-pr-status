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
  if (res.status !== 0) return { ok: false, data: null, error: res.stderr.trim() };
  try {
    return { ok: true, data: JSON.parse(res.stdout), error: null };
  } catch (err) {
    return { ok: false, data: null, error: String(err.message) };
  }
}

// `gh pr list` returns an array; `gh pr view` returns an object.
function ghList(args, opts) {
  const { data } = ghJson(args, opts);
  return Array.isArray(data) ? data : [];
}

// One call per repo covers every open PR. Callers fall back to fetchBranchPr
// only for branches that miss here.
export function fetchOpenPrs(repo, opts = {}) {
  const data = ghList(prListArgs({ repo, limit: opts.limit ?? 100 }), opts);
  const byBranch = new Map();
  for (const raw of data) {
    if (raw?.headRefName) byBranch.set(raw.headRefName, normalizePr(raw));
  }
  return byBranch;
}

export function fetchBranchPr(repo, branch, opts = {}) {
  const data = ghList(prListArgs({ repo, branch, limit: 1 }), opts);
  return data.length > 0 ? normalizePr(data[0]) : null;
}

// GitHub reports an unfinished CheckRun's completedAt as year zero rather than
// null, which naively subtracts into a two-thousand-year duration.
const ZERO_TIME = '0001-01-01T00:00:00Z';

function seconds(startedAt, completedAt) {
  if (!startedAt || !completedAt || completedAt === ZERO_TIME || startedAt === ZERO_TIME) return null;
  const ms = Date.parse(completedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 1000);
}

export function normalizeCheckDetail(check) {
  const isRun = check?.__typename === 'CheckRun';
  return {
    name: (isRun ? check.name : check?.context) ?? 'unknown',
    state: normalizeCheck(check),
    // The provider label is what distinguishes "Vercel – coolfocus" from a
    // GitHub Actions job in the list.
    provider: isRun ? (check.workflowName ?? 'GitHub') : 'status',
    durationSeconds: seconds(check?.startedAt, check?.completedAt),
    url: (isRun ? check.detailsUrl : check?.targetUrl) ?? null,
  };
}

export function checkDetails(rollup) {
  return (Array.isArray(rollup) ? rollup : []).map(normalizeCheckDetail);
}

// Per-check detail for one PR. Only called while the checks pane is open, so
// it costs nothing during normal polling.
export function fetchPrChecks(repo, number, opts = {}) {
  const args = ['pr', 'view', String(number), '--repo', repo, '--json', 'statusCheckRollup,title,url,state,reviewDecision,isDraft,additions,deletions,number,headRefName'];
  const res = ghJson(args, opts);
  if (!res.ok) return null;
  const raw = res.data;
  if (!raw || typeof raw !== 'object') return null;
  return { pr: normalizePr(raw), checks: checkDetails(raw.statusCheckRollup) };
}
