import { fetchOpenPrs, fetchBranchPr } from './github.js';
import { resolveSpaces, groupByRepo } from './spaces.js';
import { snapshot as herdrSnapshot, reportMetadata, showNotification } from './herdr.js';
import { prTokens, clearedTokens } from './tokens.js';
import { readCache, writeCache } from './state.js';
import { diffNotifications } from './notify.js';

const DEFAULT_DEPS = {
  snapshot: herdrSnapshot,
  resolveSpaces,
  fetchOpenPrs,
  fetchBranchPr,
  reportMetadata,
  showNotification,
};

const SOUND_FOR = { checks_failed: 'request', review: 'request', merged: 'done' };

// One pass: read the session, work out each space's PR, push tokens, and
// return the state the caller should persist.
export function syncOnce({
  config,
  state = { spaces: {}, cache: {} },
  env = process.env,
  now = Date.now(),
  bypassCache = false,
  firstCycle = false,
  deps = {},
} = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  const stats = { spaces: 0, repoQueries: 0, branchQueries: 0, cacheHits: 0, reported: 0 };

  const snap = d.snapshot({ env });
  if (!snap) return { ok: false, error: 'could not read herdr session snapshot', state, notifications: [], stats };

  const spaces = d.resolveSpaces(snap, {
    skipDefaultBranch: config.skipDefaultBranch,
    repos: config.repos,
  });
  stats.spaces = spaces.length;

  const cache = bypassCache ? {} : { ...(state.cache ?? {}) };
  const ghOpts = { ghPath: config.ghPath, limit: config.openPrLimit };
  const current = {};

  for (const [repo, repoSpaces] of groupByRepo(spaces)) {
    // Branches whose answer is already known need no network at all, and if
    // every branch in a repo is cached we skip the repo query entirely.
    const pending = [];
    for (const space of repoSpaces) {
      const cached = bypassCache
        ? { hit: false, pr: null }
        : readCache(cache, repo, space.branch, config, { now });
      if (cached.hit) {
        stats.cacheHits += 1;
        current[space.workspace_id] = { space, pr: cached.pr };
      } else {
        pending.push(space);
      }
    }
    if (pending.length === 0) continue;

    const open = d.fetchOpenPrs(repo, ghOpts);
    stats.repoQueries += 1;

    for (const space of pending) {
      let pr = open.get(space.branch) ?? null;
      if (!pr) {
        // Not open: it may be merged, closed, or never have existed. One
        // targeted query per unmatched branch, then cached.
        pr = d.fetchBranchPr(repo, space.branch, ghOpts);
        stats.branchQueries += 1;
        writeCache(cache, repo, space.branch, pr, { now });
      }
      current[space.workspace_id] = { space, pr };
    }
  }

  for (const [workspaceId, { space, pr }] of Object.entries(current)) {
    const tokens = pr ? prTokens(pr, config.style) : clearedTokens();
    if (d.reportMetadata(workspaceId, tokens, { ttlMs: config.tokenTtlMs, env })) stats.reported += 1;
  }

  // A space that vanished from the snapshot took its tokens with it when herdr
  // closed the workspace, so only live spaces need clearing.
  const notifications = diffNotifications(state.spaces ?? {}, current, {
    notify: config.notify,
    firstCycle,
  });
  for (const n of notifications) {
    d.showNotification(n.title, n.body, { sound: SOUND_FOR[n.kind], env });
  }

  return {
    ok: true,
    error: null,
    state: { spaces: current, cache, updatedAt: now },
    notifications,
    stats,
  };
}
