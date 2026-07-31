import { spawnSync } from 'node:child_process';

// Every process this plugin shells out to (git, gh, herdr) goes through here so
// tests can inject a fake without touching the network or the filesystem.
export function runCmd(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...opts,
  });
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? (res.error ? String(res.error.message) : ''),
  };
}
