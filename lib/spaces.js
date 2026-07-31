import { runCmd } from './exec.js';
import { parseRemoteUrl } from './github.js';

// A space's working directory comes from its worktree provenance when herdr has
// it, and otherwise from the first pane that reported a cwd. Plain (non-worktree)
// spaces have no worktree record at all, so the pane fallback is what makes a
// normal repo checkout show PR status too.
export function spaceDirs(snapshot) {
  const workspaces = snapshot?.workspaces ?? [];
  const panes = snapshot?.panes ?? [];

  const firstPaneCwd = new Map();
  for (const pane of panes) {
    if (pane?.cwd && !firstPaneCwd.has(pane.workspace_id)) {
      firstPaneCwd.set(pane.workspace_id, pane.cwd);
    }
  }

  const out = [];
  for (const ws of workspaces) {
    const dir = ws?.worktree?.checkout_path ?? firstPaneCwd.get(ws?.workspace_id) ?? null;
    if (!dir) continue;
    out.push({
      workspace_id: ws.workspace_id,
      label: ws.label ?? '',
      number: ws.number ?? 0,
      dir,
      repoRoot: ws?.worktree?.repo_root ?? dir,
      isWorktree: Boolean(ws?.worktree?.is_linked_worktree),
    });
  }
  return out;
}

function gitOut(exec, dir, args) {
  const res = exec('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  return res.status === 0 ? res.stdout.trim() : null;
}

// git only records origin/HEAD when it feels like it (fresh clones, or an
// explicit `git remote set-head`). Plenty of real checkouts have no symbolic
// ref at all, so fall back to the conventional trunk names rather than giving
// up and reporting PR status for main.
const CONVENTIONAL_TRUNKS = new Set(['main', 'master']);

function defaultBranchFor(exec, dir, cache, repoRoot) {
  if (cache.has(repoRoot)) return cache.get(repoRoot);
  const ref = gitOut(exec, dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const branch = ref ? ref.replace(/^origin\//, '') : null;
  cache.set(repoRoot, branch);
  return branch;
}

function isDefaultBranch(exec, space, cache, branch) {
  const resolved = defaultBranchFor(exec, space.dir, cache, space.repoRoot);
  if (resolved) return resolved === branch;
  return CONVENTIONAL_TRUNKS.has(branch);
}

export function resolveSpaces(snapshot, opts = {}) {
  const { exec = runCmd, skipDefaultBranch = true, repos = null } = opts;
  const allow = Array.isArray(repos) && repos.length > 0 ? new Set(repos) : null;
  const defaultBranches = new Map();
  const out = [];

  for (const space of spaceDirs(snapshot)) {
    const branch = gitOut(exec, space.dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (!branch || branch === 'HEAD') continue; // no repo, or detached

    const remote = gitOut(exec, space.dir, ['remote', 'get-url', 'origin']);
    const parsed = parseRemoteUrl(remote);
    if (!parsed) continue;

    const repo = `${parsed.owner}/${parsed.name}`;
    if (allow && !allow.has(repo)) continue;

    if (skipDefaultBranch && isDefaultBranch(exec, space, defaultBranches, branch)) continue;

    out.push({ ...space, branch, repo, host: parsed.host });
  }
  return out;
}

export function groupByRepo(spaces) {
  const byRepo = new Map();
  for (const space of spaces) {
    if (!byRepo.has(space.repo)) byRepo.set(space.repo, []);
    byRepo.get(space.repo).push(space);
  }
  return byRepo;
}
