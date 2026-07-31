import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Two things live in the state file:
//   spaces — last known PR per space, so the board renders instantly and the
//            notifier has a baseline to diff against
//   cache  — per repo+branch results whose state cannot change often
export const EMPTY_STATE = Object.freeze({ spaces: {}, cache: {}, updatedAt: 0 });

const FILE = 'state.json';

// Terminal states are the only ones worth caching. An open PR's checks and
// review are precisely the things that change between polls.
const TERMINAL = new Set(['merged', 'closed']);

export function stateFile(stateDir) {
  return join(stateDir, FILE);
}

export function loadState(stateDir) {
  if (!stateDir) return { ...EMPTY_STATE };
  try {
    const parsed = JSON.parse(readFileSync(stateFile(stateDir), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...EMPTY_STATE };
    return {
      spaces: parsed.spaces && typeof parsed.spaces === 'object' ? parsed.spaces : {},
      cache: parsed.cache && typeof parsed.cache === 'object' ? parsed.cache : {},
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

// Write through a temp file: the board pane reads this while the daemon writes
// it, and a half-written JSON blob would blank the board.
export function saveState(stateDir, state) {
  if (!stateDir) return;
  try {
    mkdirSync(stateDir, { recursive: true });
    const target = stateFile(stateDir);
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, target);
  } catch {
    // Losing the cache costs one extra API call, not correctness.
  }
}

export function cacheKey(repo, branch) {
  return `${repo}#${branch}`;
}

function ttlFor(pr, cfg) {
  if (pr === null) return (cfg.noPrCacheSeconds ?? 0) * 1000;
  if (TERMINAL.has(pr?.rolled)) return (cfg.terminalCacheMinutes ?? 0) * 60 * 1000;
  return 0;
}

export function writeCache(cache, repo, branch, pr, { now = Date.now() } = {}) {
  // Only cacheable shapes get stored at all; an open PR must be re-queried.
  if (pr !== null && !TERMINAL.has(pr?.rolled)) return cache;
  cache[cacheKey(repo, branch)] = { at: now, pr };
  return cache;
}

export function readCache(cache, repo, branch, cfg, { now = Date.now() } = {}) {
  const entry = cache?.[cacheKey(repo, branch)];
  if (!entry || typeof entry !== 'object' || typeof entry.at !== 'number') {
    return { hit: false, pr: null };
  }
  const ttl = ttlFor(entry.pr ?? null, cfg);
  if (ttl <= 0 || now - entry.at > ttl) return { hit: false, pr: null };
  return { hit: true, pr: entry.pr ?? null };
}
