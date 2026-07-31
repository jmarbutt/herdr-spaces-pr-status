import { loadState } from '../lib/state.js';
import { runSync } from '../lib/run.js';
import { openUrl } from '../lib/browser.js';

// Opens the focused space's PR. Uses cached state when it has an answer, and
// only syncs when it does not, so the common case is instant.
const stateDir = process.env.HERDR_PLUGIN_STATE_DIR;
const workspaceId = process.env.HERDR_WORKSPACE_ID;

if (!workspaceId) {
  process.stderr.write('spaces-pr-status: no focused workspace\n');
  process.exit(1);
}

function urlFor(state) {
  return state.spaces?.[workspaceId]?.pr?.url ?? null;
}

let url = urlFor(loadState(stateDir));
if (!url) {
  const result = runSync({ bypassCache: true });
  url = result.ok ? urlFor(result.state) : null;
}

if (!url) {
  process.stderr.write('spaces-pr-status: no pull request for this space\n');
  process.exit(1);
}

const ok = openUrl(url);
process.stdout.write(`spaces-pr-status: ${url}\n`);
process.exit(ok ? 0 : 1);
