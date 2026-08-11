import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

// herdr documents [[startup]] as a one-shot hook, explicitly not a supervised
// daemon, so the plugin owns supervision. The record is keyed on the socket
// path as well as the pid: a live handoff starts a new server on a new socket,
// and the old poller is then talking to a socket nobody is listening on.
const FILE = 'daemon.json';

// herdr shares one HERDR_PLUGIN_STATE_DIR across all servers; namespace per
// socket so concurrent sessions never share daemon.json or state.json.
export function sessionStateDir(stateDir, socketPath) {
  if (!stateDir || !socketPath) return stateDir;
  const hash = createHash('sha1').update(socketPath).digest('hex').slice(0, 8);
  return join(stateDir, hash);
}

export function daemonFile(stateDir) {
  return join(stateDir, FILE);
}

export function readDaemon(stateDir) {
  if (!stateDir) return null;
  try {
    const parsed = JSON.parse(readFileSync(daemonFile(stateDir), 'utf8'));
    if (typeof parsed?.pid !== 'number') return null;
    return { pid: parsed.pid, socketPath: parsed.socketPath ?? null, startedAt: parsed.startedAt ?? 0 };
  } catch {
    return null;
  }
}

export function writeDaemon(stateDir, record) {
  if (!stateDir) return;
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(daemonFile(stateDir), JSON.stringify(record));
  } catch {
    // Without the record we may double-spawn on the next start; not fatal.
  }
}

// Only erase the record if it still points at the caller. During a live
// handoff the replacement poller has already written its own record by the
// time the outgoing one gets its SIGTERM; an unguarded delete would wipe it,
// and the next startup would then spawn a second poller alongside the live
// one.
export function clearDaemon(stateDir, pid) {
  if (!stateDir) return false;
  const record = readDaemon(stateDir);
  if (pid !== undefined && record && record.pid !== pid) return false;
  try {
    unlinkSync(daemonFile(stateDir));
    return true;
  } catch {
    return false;
  }
}

export function isAlive(pid, { kill = process.kill } = {}) {
  if (!pid || pid <= 0) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to someone else.
    return err.code === 'EPERM';
  }
}

// Decide what startup should do, kept separate from doing it so the branching
// is testable without spawning anything.
export function daemonAction(record, socketPath, { kill = process.kill } = {}) {
  if (!record || !isAlive(record.pid, { kill })) return { action: 'spawn', killPid: null };
  if (record.socketPath && socketPath && record.socketPath !== socketPath) {
    // Live handoff: the running poller is bound to the previous server.
    return { action: 'respawn', killPid: record.pid };
  }
  return { action: 'keep', killPid: null };
}
