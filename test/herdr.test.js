import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportMetadata, showNotification, snapshot, focusWorkspace, openPluginPane, SOURCE } from '../lib/herdr.js';

const env = { HERDR_BIN_PATH: '/usr/local/bin/herdr' };

function recorder(result = { status: 0, stdout: '', stderr: '' }) {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push({ cmd, args });
    return typeof result === 'function' ? result(cmd, args) : result;
  };
  return { exec, calls };
}

test('reportMetadata succeeds on empty stdout', () => {
  // `herdr workspace report-metadata` exits 0 and prints nothing at all.
  // Treating "no JSON body" as failure made every token write look broken
  // while actually succeeding.
  const { exec } = recorder({ status: 0, stdout: '', stderr: '' });
  assert.equal(reportMetadata('w69', { pr: '● #1' }, { env, exec }), true);
});

test('reportMetadata fails on a non-zero exit', () => {
  const { exec } = recorder({ status: 1, stdout: '', stderr: 'workspace_not_found' });
  assert.equal(reportMetadata('w99', { pr: '● #1' }, { env, exec }), false);
});

test('reportMetadata sets string tokens and clears nulls', () => {
  const { exec, calls } = recorder();
  reportMetadata('w69', { pr: '● #1', pr_checks: null }, { env, exec, ttlMs: 360000 });
  const { cmd, args } = calls[0];
  assert.equal(cmd, '/usr/local/bin/herdr');
  assert.deepEqual(args.slice(0, 5), ['workspace', 'report-metadata', 'w69', '--source', SOURCE]);
  assert.equal(args[args.indexOf('--token') + 1], 'pr=● #1');
  assert.equal(args[args.indexOf('--clear-token') + 1], 'pr_checks');
  assert.equal(args[args.indexOf('--ttl-ms') + 1], '360000');
});

test('reportMetadata omits the ttl flag when none is given', () => {
  const { exec, calls } = recorder();
  reportMetadata('w69', { pr: '● #1' }, { env, exec });
  assert.ok(!calls[0].args.includes('--ttl-ms'));
});

test('token values survive argv without shell quoting', () => {
  // Values carry spaces and emoji; argv is passed without a shell, so they
  // must arrive as a single element.
  const { exec, calls } = recorder();
  reportMetadata('w69', { pr: '🟢 #10204' }, { env, exec });
  assert.ok(calls[0].args.includes('pr=🟢 #10204'));
});

test('showNotification succeeds on empty stdout and passes body and sound', () => {
  const { exec, calls } = recorder({ status: 0, stdout: '', stderr: '' });
  assert.equal(showNotification('WC-10200', '#1 checks failed', { env, exec, sound: 'request' }), true);
  const { args } = calls[0];
  assert.deepEqual(args.slice(0, 3), ['notification', 'show', 'WC-10200']);
  assert.equal(args[args.indexOf('--body') + 1], '#1 checks failed');
  assert.equal(args[args.indexOf('--sound') + 1], 'request');
});

test('focusWorkspace reports success by exit code alone', () => {
  const { exec } = recorder({ status: 0, stdout: '', stderr: '' });
  assert.equal(focusWorkspace('w69', { env, exec }), true);
});

test('snapshot unwraps the session snapshot envelope', () => {
  const { exec } = recorder({
    status: 0,
    stdout: JSON.stringify({ result: { snapshot: { workspaces: [{ workspace_id: 'w1' }], panes: [] } } }),
    stderr: '',
  });
  assert.deepEqual(snapshot({ env, exec }).workspaces, [{ workspace_id: 'w1' }]);
});

test('snapshot returns null rather than throwing on garbage', () => {
  assert.equal(snapshot({ env, exec: () => ({ status: 0, stdout: 'not json', stderr: '' }) }), null);
  assert.equal(snapshot({ env, exec: () => ({ status: 1, stdout: '', stderr: 'boom' }) }), null);
});

test('herdr commands go through HERDR_BIN_PATH when set', () => {
  const { exec, calls } = recorder();
  reportMetadata('w69', { pr: 'x' }, { env: {}, exec });
  assert.equal(calls[0].cmd, 'herdr');
  reportMetadata('w69', { pr: 'x' }, { env, exec });
  assert.equal(calls[1].cmd, '/usr/local/bin/herdr');
});

test('a split pane carries a target pane, because herdr rejects it otherwise', () => {
  const { exec, calls } = recorder({ status: 0, stdout: '{}', stderr: '' });
  openPluginPane('checks', { env, exec, placement: 'split', direction: 'right', targetPaneId: 'w6F:p1' });
  const { args } = calls[0];
  assert.equal(args[args.indexOf('--placement') + 1], 'split');
  assert.equal(args[args.indexOf('--target-pane') + 1], 'w6F:p1');
  assert.equal(args[args.indexOf('--direction') + 1], 'right');
});

test('a tab pane does not carry a target pane', () => {
  const { exec, calls } = recorder({ status: 0, stdout: '{}', stderr: '' });
  openPluginPane('checks', { env, exec, placement: 'tab', targetPaneId: 'w6F:p1' });
  assert.ok(!calls[0].args.includes('--target-pane'));
});

test('the board omits placement entirely so the manifest popup applies', () => {
  // The CLI's --placement enum does not list popup even though the manifest
  // and socket API accept it, so passing it would break the board.
  const { exec, calls } = recorder({ status: 0, stdout: '{}', stderr: '' });
  openPluginPane('board', { env, exec });
  assert.ok(!calls[0].args.includes('--placement'));
});
