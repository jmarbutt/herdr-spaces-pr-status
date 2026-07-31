import { loadConfig } from '../lib/config.js';
import { openPluginPane, PLACEMENTS_NEEDING_TARGET } from '../lib/herdr.js';

// Placement comes from config so the same action gives a desktop side panel
// (split) or a tab, which is what herdr's single-column mobile layout wants.
const config = loadConfig(process.env.HERDR_PLUGIN_CONFIG_DIR);

function focusedPaneId() {
  if (process.env.HERDR_PANE_ID) return process.env.HERDR_PANE_ID;
  try {
    return JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON ?? '{}').focused_pane_id ?? null;
  } catch {
    return null;
  }
}

const placement = config.checksPlacement;
const targetPaneId = focusedPaneId();

// A split has to be positioned against a real pane. Without one, fall back to
// a tab rather than failing outright.
const effective = PLACEMENTS_NEEDING_TARGET.has(placement) && !targetPaneId ? 'tab' : placement;

const res = openPluginPane('checks', {
  placement: effective,
  direction: effective === 'split' ? 'right' : undefined,
  targetPaneId,
});

if (!res.ok) {
  process.stderr.write(`spaces-pr-status: could not open checks: ${res.error}\n`);
  process.exit(1);
}
process.exit(0);
