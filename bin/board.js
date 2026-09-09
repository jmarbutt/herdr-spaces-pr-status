import { loadConfig } from '../lib/config.js';
import { loadState } from '../lib/state.js';
import { runSync } from '../lib/run.js';
import { focusWorkspace } from '../lib/herdr.js';
import { renderBoard, buildRows, selectableIndexes } from '../lib/render.js';
import { openUrl } from '../lib/browser.js';
import { sessionStateDir } from '../lib/daemon-state.js';

// The board is a popup pane: session-modal, receives every key including
// Escape, and closes when this process exits.
const config = loadConfig(process.env.HERDR_PLUGIN_CONFIG_DIR);
const stateDir = sessionStateDir(process.env.HERDR_PLUGIN_STATE_DIR, process.env.HERDR_SOCKET_PATH);

const ESC = '\u001b';
const ALT_SCREEN_ON = `${ESC}[?1049h`;
const ALT_SCREEN_OFF = `${ESC}[?1049l`;
const CURSOR_HIDE = `${ESC}[?25l`;
const CURSOR_SHOW = `${ESC}[?25h`;
const CLEAR = `${ESC}[2J${ESC}[H`;
const CTRL_C = '\u0003';

let spaces = [];
let selected = 0;
let status = '';

function loadFromState() {
  // Render from cache first: the board should appear instantly, not after a
  // round trip to GitHub.
  const state = loadState(stateDir);
  spaces = Object.values(state.spaces ?? {}).filter((e) => e?.space);
}

function rows() {
  return buildRows(spaces);
}

function clampSelection() {
  const idx = selectableIndexes(rows());
  if (idx.length === 0) {
    selected = 0;
    return idx;
  }
  if (!idx.includes(selected)) selected = idx[0];
  return idx;
}

function draw() {
  clampSelection();
  const width = process.stdout.columns || 80;
  process.stdout.write(CLEAR + renderBoard({ spaces, width, selected, style: config.style, status }));
}

function move(delta) {
  const idx = clampSelection();
  if (idx.length === 0) return;
  const at = idx.indexOf(selected);
  selected = idx[Math.min(idx.length - 1, Math.max(0, at + delta))];
  draw();
}

function currentRow() {
  return rows()[selected];
}

function refresh() {
  status = 'refreshing';
  draw();
  const result = runSync({ bypassCache: true });
  loadFromState();
  status = result.ok ? '' : result.error;
  draw();
}

function quit(code = 0) {
  process.stdout.write(CURSOR_SHOW + ALT_SCREEN_OFF);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(code);
}

function focusSelected() {
  const row = currentRow();
  if (row?.type !== 'item') return;
  focusWorkspace(row.space.workspace_id);
  quit(0);
}

function openSelected() {
  const row = currentRow();
  if (row?.type !== 'item' || !row.pr?.url) {
    status = 'no pull request for that space';
    draw();
    return;
  }
  status = openUrl(row.pr.url) ? `opened #${row.pr.number}` : 'could not open browser';
  draw();
}

function onKey(key) {
  // Arrow keys arrive as ESC [ A/B; j/k are the vim equivalents herdr users expect.
  if (key === `${ESC}[A` || key === 'k') return move(-1);
  if (key === `${ESC}[B` || key === 'j') return move(1);
  if (key === '\r' || key === '\n') return focusSelected();
  if (key === 'o') return openSelected();
  if (key === 'r') return refresh();
  if (key === 'q' || key === ESC || key === CTRL_C) return quit(0);
}

loadFromState();
process.stdout.write(ALT_SCREEN_ON + CURSOR_HIDE);
draw();

// Nothing cached yet means this is a first run; fetch so the board is not empty.
if (spaces.length === 0) refresh();

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', onKey);
process.stdout.on('resize', draw);
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => quit(0));
