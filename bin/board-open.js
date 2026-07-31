import { openPluginPane } from '../lib/herdr.js';

// A keybinding can target a plugin action but not a plugin pane, so this
// action exists purely to open the board entrypoint.
const res = openPluginPane('board');
if (!res.ok) {
  process.stderr.write(`spaces-pr-status: could not open board: ${res.error}\n`);
  process.exit(1);
}
process.exit(0);
