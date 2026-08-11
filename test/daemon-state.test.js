import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readDaemon,
  writeDaemon,
  clearDaemon,
  daemonFile,
  isAlive,
  daemonAction,
  sessionStateDir,
} from '../lib/daemon-state.js';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'prstatus-daemon-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SOCK = '/Users/x/.config/herdr/herdr.sock';
const OTHER_SOCK = '/Users/x/.config/herdr/herdr-2.sock';

test('readDaemon returns null when nothing is recorded', () => {
  withDir((dir) => assert.equal(readDaemon(dir), null));
  assert.equal(readDaemon(undefined), null);
});

test('readDaemon returns null on a corrupt record', () => {
  withDir((dir) => {
    writeFileSync(daemonFile(dir), 'nonsense');
    assert.equal(readDaemon(dir), null);
  });
});

test('readDaemon rejects a record with no numeric pid', () => {
  withDir((dir) => {
    writeFileSync(daemonFile(dir), JSON.stringify({ socketPath: SOCK }));
    assert.equal(readDaemon(dir), null);
  });
});

test('writeDaemon then readDaemon round-trips', () => {
  withDir((dir) => {
    writeDaemon(dir, { pid: 4242, socketPath: SOCK, startedAt: 123 });
    assert.deepEqual(readDaemon(dir), { pid: 4242, socketPath: SOCK, startedAt: 123 });
  });
});

test('clearDaemon removes the record and tolerates a missing file', () => {
  withDir((dir) => {
    writeDaemon(dir, { pid: 1, socketPath: SOCK });
    clearDaemon(dir);
    assert.equal(existsSync(daemonFile(dir)), false);
    assert.doesNotThrow(() => clearDaemon(dir));
  });
});

test('clearDaemon refuses to erase a record belonging to another process', () => {
  // During a live handoff the replacement poller writes its record before the
  // outgoing one handles SIGTERM. An unguarded delete wipes the newcomer's
  // record, and the next startup then spawns a second poller alongside it.
  withDir((dir) => {
    writeDaemon(dir, { pid: 4242, socketPath: SOCK });
    assert.equal(clearDaemon(dir, 1111), false, 'the outgoing pid must not win');
    assert.deepEqual(readDaemon(dir).pid, 4242);
    assert.equal(clearDaemon(dir, 4242), true);
    assert.equal(existsSync(daemonFile(dir)), false);
  });
});

test('clearDaemon with no record is a harmless no-op', () => {
  withDir((dir) => assert.equal(clearDaemon(dir, 1), false));
  assert.equal(clearDaemon(undefined, 1), false);
});

test('isAlive is true for this very process and false for a dead pid', () => {
  assert.equal(isAlive(process.pid), true);
  const dead = () => {
    const err = new Error('no such process');
    err.code = 'ESRCH';
    throw err;
  };
  assert.equal(isAlive(999999, { kill: dead }), false);
});

test('isAlive treats EPERM as alive, because the process exists', () => {
  const perm = () => {
    const err = new Error('operation not permitted');
    err.code = 'EPERM';
    throw err;
  };
  assert.equal(isAlive(1, { kill: perm }), true);
});

test('isAlive rejects nonsense pids', () => {
  assert.equal(isAlive(0), false);
  assert.equal(isAlive(-1), false);
  assert.equal(isAlive(undefined), false);
});

const alive = () => true;
const dead = () => {
  const err = new Error('gone');
  err.code = 'ESRCH';
  throw err;
};

test('sessionStateDir namespaces per socket so sessions never share state', () => {
  const dir = '/tmp/prstatus-state';
  const a = sessionStateDir(dir, SOCK);
  const b = sessionStateDir(dir, OTHER_SOCK);
  assert.equal(a.startsWith(dir + '/'), true);
  assert.notEqual(a, b);
  assert.equal(sessionStateDir(dir, SOCK), a);
});

test('sessionStateDir falls back to the plain state dir when either input is missing', () => {
  assert.equal(sessionStateDir('/tmp/state', null), '/tmp/state');
  assert.equal(sessionStateDir('/tmp/state', undefined), '/tmp/state');
  assert.equal(sessionStateDir(null, SOCK), null);
  assert.equal(sessionStateDir(undefined, SOCK), undefined);
});

test('daemonAction spawns when there is no record', () => {
  assert.deepEqual(daemonAction(null, SOCK, { kill: alive }), { action: 'spawn', killPid: null });
});

test('daemonAction spawns when the recorded process is gone', () => {
  assert.deepEqual(daemonAction({ pid: 5, socketPath: SOCK }, SOCK, { kill: dead }), {
    action: 'spawn',
    killPid: null,
  });
});

test('daemonAction keeps a healthy poller on the same socket', () => {
  assert.deepEqual(daemonAction({ pid: 5, socketPath: SOCK }, SOCK, { kill: alive }), {
    action: 'keep',
    killPid: null,
  });
});

test('daemonAction respawns after a live handoff moves the socket', () => {
  // Startup runs again on handoff; the old poller is bound to a dead socket
  // and must be replaced rather than left to run alongside a new one.
  assert.deepEqual(daemonAction({ pid: 5, socketPath: OTHER_SOCK }, SOCK, { kill: alive }), {
    action: 'respawn',
    killPid: 5,
  });
});

test('daemonAction keeps a live poller whose socket path is unknown', () => {
  // No recorded socket is not evidence of a handoff; killing would be worse.
  assert.deepEqual(daemonAction({ pid: 5, socketPath: null }, SOCK, { kill: alive }), {
    action: 'keep',
    killPid: null,
  });
});
