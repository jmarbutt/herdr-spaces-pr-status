import { loadConfig } from '../lib/config.js';
import { loadState } from '../lib/state.js';
import { snapshot } from '../lib/herdr.js';
import { resolveSpaces } from '../lib/spaces.js';
import { fetchPrChecks, fetchOpenPrs, fetchBranchPr } from '../lib/github.js';
import { renderChecks } from '../lib/checks-render.js';
import { openUrl } from '../lib/browser.js';
import { sessionStateDir } from '../lib/daemon-state.js';

// A per-space checks view. Opened as a split it is a desktop side panel; as a
// tab it is what works on herdr's single-column mobile layout. Same process
// either way.
const config = loadConfig(process.env.HERDR_PLUGIN_CONFIG_DIR);
const stateDir = sessionStateDir(process.env.HERDR_PLUGIN_STATE_DIR, process.env.HERDR_SOCKET_PATH);

// The pane is launched from a workspace, and its own pane belongs to that
// workspace, so this is the space whose checks we show.
const workspaceId = process.env.HERDR_WORKSPACE_ID ?? null;

const ESC = '\u001b';
const ALT_ON = `${ESC}[?1049h`;
const ALT_OFF = `${ESC}[?1049l`;
const HIDE = `${ESC}[?25l`;
const SHOW = `${ESC}[?25h`;
const CLEAR = `${ESC}[2J${ESC}[H`;
const CTRL_C = '\u0003';

let space = null;
let pr = null;
let checks = [];
let status = 'loading';
let timer = null;

function draw() {
  const width = process.stdout.columns || 40;
  process.stdout.write(CLEAR + renderChecks({ space, pr, checks, width, style: config.style, status }));
}

function resolveSpace() {
  const snap = snapshot();
  if (!snap) return null;
  const spaces = resolveSpaces(snap, { skipDefaultBranch: false, repos: config.repos });
  return spaces.find((s) => s.workspace_id === workspaceId) ?? null;
}

function findPr(target) {
  const ghOpts = { ghPath: config.ghPath, limit: config.openPrLimit };
  const open = fetchOpenPrs(target.repo, ghOpts);
  return open.get(target.branch) ?? fetchBranchPr(target.repo, target.branch, ghOpts);
}

function refresh() {
  status = 'refreshing';
  draw();

  space = resolveSpace();
  if (!space) {
    pr = null;
    checks = [];
    status = '';
    draw();
    return;
  }

  // The cached PR number saves a lookup; the check detail is always fresh,
  // because a pane you are staring at should not show stale checks.
  const cached = loadState(stateDir).spaces?.[workspaceId]?.pr ?? null;
  const found = cached?.branch === space.branch ? cached : findPr(space);

  if (!found) {
    pr = null;
    checks = [];
    status = '';
    draw();
    return;
  }

  const detail = fetchPrChecks(space.repo, found.number, { ghPath: config.ghPath });
  if (detail) {
    pr = detail.pr;
    checks = detail.checks;
    status = '';
  } else {
    pr = found;
    checks = [];
    status = 'could not read checks';
  }
  draw();
}

function quit(code = 0) {
  clearInterval(timer);
  process.stdout.write(SHOW + ALT_OFF);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(code);
}

function onKey(key) {
  if (key === 'r') return refresh();
  if (key === 'o') {
    status = pr?.url && openUrl(pr.url) ? `opened #${pr.number}` : 'no pull request to open';
    return draw();
  }
  if (key === 'q' || key === ESC || key === CTRL_C) return quit(0);
}

process.stdout.write(ALT_ON + HIDE);
draw();
refresh();

// While the pane is open, keep it live: a running check that never turns green
// on screen is worse than no pane at all.
timer = setInterval(refresh, config.checksRefreshSeconds * 1000);

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', onKey);
process.stdout.on('resize', draw);
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => quit(0));
