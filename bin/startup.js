import { spawn } from 'node:child_process';
import { openSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDaemon, writeDaemon, daemonAction } from '../lib/daemon-state.js';

// Runs on server start, on live handoff, and after worktree.created as a
// self-heal. Its only job is to guarantee exactly one poller is alive and
// bound to the current server.
const here = dirname(fileURLToPath(import.meta.url));
const stateDir = process.env.HERDR_PLUGIN_STATE_DIR;
const socketPath = process.env.HERDR_SOCKET_PATH ?? null;

const { action, killPid } = daemonAction(readDaemon(stateDir), socketPath);

if (action === 'keep') {
  process.stdout.write('spaces-pr-status: poller already running\n');
  process.exit(0);
}

if (killPid) {
  try {
    process.kill(killPid, 'SIGTERM');
  } catch {
    // Already gone between the check and here.
  }
}

let stdio = ['ignore', 'ignore', 'ignore'];
if (stateDir) {
  try {
    mkdirSync(stateDir, { recursive: true });
    const fd = openSync(join(stateDir, 'daemon.log'), 'a');
    stdio = ['ignore', fd, fd];
  } catch {
    // Logging is a nicety; run without it.
  }
}

const child = spawn(process.execPath, [join(here, 'daemon.js')], {
  detached: true,
  stdio,
  env: process.env,
  cwd: here,
});
child.unref();

writeDaemon(stateDir, { pid: child.pid, socketPath, startedAt: Date.now() });
process.stdout.write(`spaces-pr-status: poller ${action === 'respawn' ? 'respawned' : 'started'} (pid ${child.pid})\n`);
process.exit(0);
