import { loadConfig } from '../lib/config.js';
import { openPluginPane } from '../lib/herdr.js';

// Placement comes from config so the same action gives a desktop side panel
// (split) or a tab, which is what herdr's single-column mobile layout wants.
const config = loadConfig(process.env.HERDR_PLUGIN_CONFIG_DIR);

const res = openPluginPane('checks', {
  placement: config.checksPlacement,
  direction: config.checksPlacement === 'split' ? 'right' : undefined,
});

if (!res.ok) {
  process.stderr.write(`spaces-pr-status: could not open checks: ${res.error}\n`);
  process.exit(1);
}
process.exit(0);
