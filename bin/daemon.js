import { loadConfig } from '../lib/config.js';
import { runSync, summarize } from '../lib/run.js';
import { subscribe } from '../lib/herdr.js';
import { clearDaemon } from '../lib/daemon-state.js';

// The poller. Started detached by bin/startup.js, never by herdr directly.
// Herdr's own event stream drives the interesting refreshes; the interval is
// there for the things herdr cannot tell us about, like a CI run finishing.
const config = loadConfig(process.env.HERDR_PLUGIN_CONFIG_DIR);
const stateDir = process.env.HERDR_PLUGIN_STATE_DIR;

const EVENT_DEBOUNCE_MS = 2000;

const log = (msg) => process.stdout.write(`${new Date().toISOString()} ${msg}\n`);

let firstCycle = true;
let running = false;
let queued = false;
let debounce = null;

async function cycle(reason) {
  if (running) {
    queued = true;
    return;
  }
  running = true;
  try {
    const result = runSync({ firstCycle });
    firstCycle = false;
    log(`${summarize(result)} [${reason}]`);
  } catch (err) {
    log(`spaces-pr-status: cycle failed: ${err?.stack ?? err}`);
  } finally {
    running = false;
    if (queued) {
      queued = false;
      setImmediate(() => cycle('queued'));
    }
  }
}

function scheduleFromEvent(type) {
  clearTimeout(debounce);
  debounce = setTimeout(() => cycle(type), EVENT_DEBOUNCE_MS);
}

function shutdown(why, code = 0) {
  log(`spaces-pr-status: poller exiting (${why})`);
  clearDaemon(stateDir, process.pid);
  process.exit(code);
}

log(`spaces-pr-status: poller starting (pid ${process.pid}, every ${config.pollSeconds}s)`);

cycle('startup');
const timer = setInterval(() => cycle('interval'), config.pollSeconds * 1000);

const stream = subscribe(
  [
    { type: 'workspace.created' },
    { type: 'workspace.closed' },
    { type: 'workspace.focused' },
    { type: 'worktree.created' },
    { type: 'worktree.opened' },
    { type: 'worktree.removed' },
  ],
  {
    onEvent: (msg) => {
      const type = msg?.event?.type ?? msg?.result?.type;
      // The subscribe acknowledgement is not a reason to resync.
      if (!type || type === 'subscription_started') return;
      scheduleFromEvent(type);
    },
    // The socket dying means the server did. Exit and let the next [[startup]]
    // bring us back, rather than polling a server that is not there.
    onClose: (err) => {
      clearInterval(timer);
      shutdown(err ? `socket error: ${err.message}` : 'socket closed');
    },
  },
);

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => {
    clearInterval(timer);
    stream.close();
    shutdown(sig);
  });
}
