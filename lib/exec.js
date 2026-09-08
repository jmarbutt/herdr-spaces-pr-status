import { spawnSync } from 'node:child_process';

// Every process this plugin shells out to (git, gh, herdr) goes through here so
// tests can inject a fake without touching the network or the filesystem.

// The timeout is load-bearing, not a nicety. A cycle is synchronous all the way
// down, so one command that never returns blocks the poller's event loop for
// good: no further cycles, no log line, no SIGTERM handling, and every token
// expiring out of the sidebar a few minutes later. `gh` sets no request timeout
// of its own, so a TCP connection killed under it — laptop sleep, VPN drop,
// corporate proxy — hangs until the machine reboots.
export const DEFAULT_TIMEOUT_MS = 45000;

// SIGKILL rather than SIGTERM: the process we are giving up on is by definition
// one that stopped responding.
export function runCmd(cmd, args, opts = {}) {
  const { spawn = spawnSync, ...spawnOpts } = opts;
  const res = spawn(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: DEFAULT_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    ...spawnOpts,
  });
  // A timeout leaves stderr empty, so the error message is the only account of
  // what happened; `||` rather than `??` so it survives.
  const message = res.error ? String(res.error.message) : '';
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? '',
    stderr: res.stderr || message,
  };
}
