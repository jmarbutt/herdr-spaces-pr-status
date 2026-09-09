import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCmd, DEFAULT_TIMEOUT_MS } from '../lib/exec.js';

test('runCmd bounds every command by default', () => {
  let seen = null;
  const spawn = (cmd, args, opts) => {
    seen = opts;
    return { status: 0, stdout: '', stderr: '' };
  };
  runCmd('gh', ['pr', 'list'], { spawn });
  assert.equal(seen.timeout, DEFAULT_TIMEOUT_MS);
  assert.equal(seen.killSignal, 'SIGKILL');
  assert.ok(DEFAULT_TIMEOUT_MS > 0);
});

test('runCmd lets a caller shorten the timeout but not remove it', () => {
  let seen = null;
  const spawn = (cmd, args, opts) => {
    seen = opts;
    return { status: 0, stdout: '', stderr: '' };
  };
  runCmd('gh', [], { spawn, timeout: 1000 });
  assert.equal(seen.timeout, 1000);
});

// The point of the timeout: a command that never returns must not become a
// command the caller waits on forever.
test('runCmd returns non-zero when a command outlives its timeout', () => {
  const started = Date.now();
  const res = runCmd(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { timeout: 300 });
  assert.notEqual(res.status, 0);
  assert.ok(Date.now() - started < 30000, 'returned promptly rather than waiting out the child');
});

test('runCmd keeps the error message when the failure left no stderr', () => {
  const spawn = () => ({ status: null, stdout: '', stderr: '', error: new Error('spawnSync gh ETIMEDOUT') });
  const res = runCmd('gh', [], { spawn });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /ETIMEDOUT/);
});
