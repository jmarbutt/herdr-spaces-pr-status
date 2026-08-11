import { loadConfig } from './config.js';
import { loadState, saveState } from './state.js';
import { syncOnce } from './sync.js';
import { sessionStateDir } from './daemon-state.js';

// Shared by the refresh action, the daemon loop, and the board's own refresh:
// load config and prior state, sync, persist. Kept in one place so all three
// agree on cache and notification behaviour.
export function runSync({ env = process.env, bypassCache = false, firstCycle = false, deps } = {}) {
  const config = loadConfig(env.HERDR_PLUGIN_CONFIG_DIR);
  const stateDir = sessionStateDir(env.HERDR_PLUGIN_STATE_DIR, env.HERDR_SOCKET_PATH);
  const state = loadState(stateDir);

  const result = syncOnce({ config, state, env, bypassCache, firstCycle, deps });
  if (result.ok) saveState(stateDir, result.state);
  return { ...result, config };
}

export function summarize(result) {
  if (!result.ok) return `spaces-pr-status: ${result.error}`;
  const { spaces, repoQueries, branchQueries, cacheHits, reported } = result.stats;
  return (
    `spaces-pr-status: ${spaces} space${spaces === 1 ? '' : 's'}, ${reported} reported ` +
    `(${repoQueries} repo ${repoQueries === 1 ? 'query' : 'queries'}, ` +
    `${branchQueries} branch, ${cacheHits} cached)`
  );
}
