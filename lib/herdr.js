import { connect } from 'node:net';
import { runCmd } from './exec.js';

// Two ways into herdr. The CLI (HERDR_BIN_PATH) is portable across the unix
// socket and Windows named pipe, so one-shot commands use it. The raw socket
// is only needed for events.subscribe, which the CLI does not expose.
export const SOURCE = 'jmarbutt.spaces-pr-status';

export function herdrBin(env = process.env) {
  return env.HERDR_BIN_PATH || 'herdr';
}

// Not every herdr command prints JSON. `workspace report-metadata` and
// `notification show` succeed with completely empty stdout, so success is the
// exit code; parsing is a separate concern for the commands that do return a
// body.
function cli(args, { env = process.env, exec = runCmd } = {}) {
  const res = exec(herdrBin(env), args, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.status !== 0) {
    return { ok: false, stdout: res.stdout, error: res.stderr.trim() || res.stdout.trim() };
  }
  return { ok: true, stdout: res.stdout, error: null };
}

function cliJson(args, opts) {
  const res = cli(args, opts);
  if (!res.ok) return { ok: false, data: null, error: res.error };
  try {
    return { ok: true, data: JSON.parse(res.stdout), error: null };
  } catch (err) {
    return { ok: false, data: null, error: String(err.message) };
  }
}

export function snapshot(opts = {}) {
  const { ok, data } = cliJson(['api', 'snapshot'], opts);
  return ok ? (data?.result?.snapshot ?? null) : null;
}

// tokens is a patch: a string sets a key, null clears it, an omitted key is
// left alone. herdr accepts at most 16 keys per report.
export function reportMetadata(workspaceId, tokens, { ttlMs, ...opts } = {}) {
  const args = ['workspace', 'report-metadata', workspaceId, '--source', SOURCE];
  for (const [key, value] of Object.entries(tokens)) {
    if (value === null || value === undefined) args.push('--clear-token', key);
    else args.push('--token', `${key}=${value}`);
  }
  if (ttlMs) args.push('--ttl-ms', String(ttlMs));
  return cli(args, opts).ok;
}

export function showNotification(title, body, { sound, ...opts } = {}) {
  const args = ['notification', 'show', title];
  if (body) args.push('--body', body);
  if (sound) args.push('--sound', sound);
  return cli(args, opts).ok;
}

export function focusWorkspace(workspaceId, opts = {}) {
  return cli(['workspace', 'focus', workspaceId], opts).ok;
}

export function openPluginPane(entrypoint, { placement, direction, focus = true, ...opts } = {}) {
  // Omitting --placement lets the manifest's own placement apply, which matters
  // for popup: the CLI's accepted values lag the manifest's and reject it.
  const args = ['plugin', 'pane', 'open', '--plugin', SOURCE, '--entrypoint', entrypoint];
  if (placement) args.push('--placement', placement);
  if (direction) args.push('--direction', direction);
  args.push(focus ? '--focus' : '--no-focus');
  return cliJson(args, opts);
}

export function listWorkspaces(opts = {}) {
  const { ok, data } = cliJson(['workspace', 'list'], opts);
  return ok ? (data?.result?.workspaces ?? []) : [];
}

// Newline-delimited JSON over $HERDR_SOCKET_PATH. Used only for the event
// stream; every other call goes through the CLI.
export function subscribe(subscriptions, { env = process.env, onEvent, onClose } = {}) {
  const path = env.HERDR_SOCKET_PATH;
  if (!path) {
    onClose?.(new Error('HERDR_SOCKET_PATH is not set'));
    return { close() {} };
  }

  const sock = connect(path);
  let buffer = '';
  let closed = false;

  const finish = (err) => {
    if (closed) return;
    closed = true;
    onClose?.(err ?? null);
  };

  sock.setEncoding('utf8');
  sock.on('connect', () => {
    sock.write(`${JSON.stringify({ id: 'sub', method: 'events.subscribe', params: { subscriptions } })}\n`);
  });
  sock.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        onEvent?.(JSON.parse(line));
      } catch {
        // A line we cannot parse is not worth killing the stream over.
      }
    }
  });
  sock.on('error', finish);
  sock.on('close', () => finish(null));

  return {
    close() {
      closed = true;
      sock.destroy();
    },
  };
}
