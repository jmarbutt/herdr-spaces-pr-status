import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRemoteUrl,
  normalizeCheck,
  summarizeChecks,
  rollupPrState,
  normalizePr,
  prListArgs,
  fetchOpenPrs,
  fetchResolvableThreads,
  fetchPrChecks,
  fetchBranchPr,
} from '../lib/github.js';

test('parseRemoteUrl handles ssh, https, and scp-style remotes', () => {
  assert.deepEqual(parseRemoteUrl('git@github.com:waycool/CoolFocus.git'), {
    host: 'github.com',
    owner: 'waycool',
    name: 'CoolFocus',
  });
  assert.deepEqual(parseRemoteUrl('https://github.com/waycool/CoolFocus.git'), {
    host: 'github.com',
    owner: 'waycool',
    name: 'CoolFocus',
  });
  assert.deepEqual(parseRemoteUrl('https://github.com/jmarbutt/herdr-spaces-pr-status'), {
    host: 'github.com',
    owner: 'jmarbutt',
    name: 'herdr-spaces-pr-status',
  });
  assert.deepEqual(parseRemoteUrl('ssh://git@github.com/waycool/CoolFocus.git'), {
    host: 'github.com',
    owner: 'waycool',
    name: 'CoolFocus',
  });
});

test('parseRemoteUrl keeps the host so GitHub Enterprise is distinguishable', () => {
  assert.deepEqual(parseRemoteUrl('git@github.example.com:team/app.git'), {
    host: 'github.example.com',
    owner: 'team',
    name: 'app',
  });
});

test('parseRemoteUrl rejects junk', () => {
  assert.equal(parseRemoteUrl(''), null);
  assert.equal(parseRemoteUrl(null), null);
  assert.equal(parseRemoteUrl('/Users/jonathan/some/local/path'), null);
  assert.equal(parseRemoteUrl('git@github.com:onlyowner.git'), null);
});

test('normalizeCheck maps CheckRun status and conclusion', () => {
  // An incomplete run is pending regardless of a stale conclusion.
  assert.equal(normalizeCheck({ __typename: 'CheckRun', status: 'IN_PROGRESS' }), 'pending');
  assert.equal(normalizeCheck({ __typename: 'CheckRun', status: 'QUEUED' }), 'pending');
  assert.equal(
    normalizeCheck({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }),
    'pass',
  );
  assert.equal(
    normalizeCheck({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }),
    'fail',
  );
  assert.equal(
    normalizeCheck({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'TIMED_OUT' }),
    'fail',
  );
  assert.equal(
    normalizeCheck({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'ACTION_REQUIRED' }),
    'fail',
  );
  // SKIPPED is the common case on this repo and must not read as a pass.
  assert.equal(
    normalizeCheck({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' }),
    'neutral',
  );
  assert.equal(
    normalizeCheck({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'CANCELLED' }),
    'neutral',
  );
});

test('normalizeCheck maps StatusContext state', () => {
  assert.equal(normalizeCheck({ __typename: 'StatusContext', state: 'SUCCESS' }), 'pass');
  assert.equal(normalizeCheck({ __typename: 'StatusContext', state: 'FAILURE' }), 'fail');
  assert.equal(normalizeCheck({ __typename: 'StatusContext', state: 'ERROR' }), 'fail');
  assert.equal(normalizeCheck({ __typename: 'StatusContext', state: 'PENDING' }), 'pending');
  assert.equal(normalizeCheck({ __typename: 'StatusContext', state: 'EXPECTED' }), 'pending');
});

test('normalizeCheck treats an unknown typename as neutral rather than throwing', () => {
  assert.equal(normalizeCheck({ __typename: 'SomethingNew', state: 'SUCCESS' }), 'neutral');
  assert.equal(normalizeCheck(null), 'neutral');
});

test('summarizeChecks counts a mixed CheckRun and StatusContext rollup', () => {
  // Both shapes on one PR, exactly as waycool/CoolFocus#10110 returns them.
  const rollup = [
    { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED', name: 'Detect env' },
    { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS', name: 'E2E smoke' },
    { __typename: 'CheckRun', status: 'IN_PROGRESS', name: 'Backend CI' },
    { __typename: 'StatusContext', state: 'SUCCESS', context: 'PR Gate / .NET Unit Tests' },
    { __typename: 'StatusContext', state: 'PENDING', context: 'Vercel – coolfocus' },
  ];
  assert.deepEqual(summarizeChecks(rollup), {
    pass: 2,
    fail: 0,
    pending: 2,
    neutral: 1,
    relevant: 4,
    state: 'pending',
  });
});

test('summarizeChecks reports fail ahead of pending', () => {
  const rollup = [
    { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' },
    { __typename: 'CheckRun', status: 'IN_PROGRESS' },
    { __typename: 'StatusContext', state: 'SUCCESS' },
  ];
  const s = summarizeChecks(rollup);
  assert.equal(s.state, 'fail');
  assert.equal(s.fail, 1);
  assert.equal(s.relevant, 3);
});

test('summarizeChecks handles no checks and skipped-only checks', () => {
  assert.deepEqual(summarizeChecks([]), {
    pass: 0,
    fail: 0,
    pending: 0,
    neutral: 0,
    relevant: 0,
    state: 'none',
  });
  assert.deepEqual(summarizeChecks(null), {
    pass: 0,
    fail: 0,
    pending: 0,
    neutral: 0,
    relevant: 0,
    state: 'none',
  });
  // Every check skipped means nothing meaningful to report.
  const skipped = summarizeChecks([
    { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' },
  ]);
  assert.equal(skipped.state, 'none');
  assert.equal(skipped.relevant, 0);
  assert.equal(skipped.neutral, 1);
});

test('rollupPrState ranks merged and closed above everything', () => {
  assert.equal(rollupPrState({ state: 'MERGED', isDraft: true, checks: { state: 'fail' } }), 'merged');
  assert.equal(rollupPrState({ state: 'CLOSED', checks: { state: 'fail' } }), 'closed');
});

test('rollupPrState ranks draft above check state', () => {
  assert.equal(rollupPrState({ state: 'OPEN', isDraft: true, checks: { state: 'fail' } }), 'draft');
});

test('rollupPrState falls through check state to open', () => {
  assert.equal(rollupPrState({ state: 'OPEN', isDraft: false, checks: { state: 'fail' } }), 'checks_failed');
  assert.equal(
    rollupPrState({ state: 'OPEN', isDraft: false, checks: { state: 'pending' } }),
    'checks_pending',
  );
  assert.equal(rollupPrState({ state: 'OPEN', isDraft: false, checks: { state: 'pass' } }), 'open');
  assert.equal(rollupPrState({ state: 'OPEN', isDraft: false, checks: { state: 'none' } }), 'open');
});

test('normalizePr flattens a raw gh record', () => {
  const raw = {
    number: 10110,
    headRefName: 'wc-10202-compliance-studio',
    state: 'OPEN',
    isDraft: false,
    reviewDecision: 'CHANGES_REQUESTED',
    additions: 914,
    deletions: 46,
    url: 'https://github.com/waycool/CoolFocus/pull/10110',
    statusCheckRollup: [
      { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' },
      { __typename: 'StatusContext', state: 'SUCCESS' },
    ],
  };
  const pr = normalizePr(raw);
  assert.equal(pr.number, 10110);
  assert.equal(pr.branch, 'wc-10202-compliance-studio');
  assert.equal(pr.state, 'OPEN');
  assert.equal(pr.review, 'CHANGES_REQUESTED');
  assert.equal(pr.additions, 914);
  assert.equal(pr.deletions, 46);
  assert.equal(pr.url, 'https://github.com/waycool/CoolFocus/pull/10110');
  assert.equal(pr.checks.state, 'fail');
  assert.equal(pr.rolled, 'checks_failed');
});

test('normalizePr turns an empty reviewDecision into null', () => {
  const pr = normalizePr({ number: 1, headRefName: 'b', state: 'OPEN', reviewDecision: '' });
  assert.equal(pr.review, null);
});

test('normalizePr survives missing optional fields', () => {
  const pr = normalizePr({ number: 7, headRefName: 'x', state: 'MERGED' });
  assert.equal(pr.rolled, 'merged');
  assert.equal(pr.additions, 0);
  assert.equal(pr.deletions, 0);
  assert.equal(pr.checks.state, 'none');
  assert.equal(pr.url, null);
});

test('prListArgs builds the one-call-per-repo open query', () => {
  const args = prListArgs({ repo: 'waycool/CoolFocus', limit: 100 });
  assert.deepEqual(args.slice(0, 6), [
    'pr',
    'list',
    '--repo',
    'waycool/CoolFocus',
    '--state',
    'open',
  ]);
  assert.ok(args.includes('--limit'));
  assert.equal(args[args.indexOf('--limit') + 1], '100');
  const fields = args[args.indexOf('--json') + 1].split(',');
  for (const f of ['number', 'headRefName', 'state', 'isDraft', 'reviewDecision', 'statusCheckRollup', 'additions', 'deletions', 'url']) {
    assert.ok(fields.includes(f), `missing json field ${f}`);
  }
  assert.ok(!args.includes('--head'));
});

test('prListArgs builds the per-branch fallback query across all states', () => {
  const args = prListArgs({ repo: 'waycool/CoolFocus', branch: 'wc-10196-fix', limit: 1 });
  assert.equal(args[args.indexOf('--head') + 1], 'wc-10196-fix');
  assert.equal(args[args.indexOf('--state') + 1], 'all');
  assert.equal(args[args.indexOf('--limit') + 1], '1');
});

test('fetchOpenPrs indexes normalized PRs by branch', () => {
  const exec = () => ({
    status: 0,
    stdout: JSON.stringify([
      { number: 1, headRefName: 'feat-a', state: 'OPEN', statusCheckRollup: [] },
      { number: 2, headRefName: 'feat-b', state: 'OPEN', isDraft: true, statusCheckRollup: [] },
    ]),
    stderr: '',
  });
  const byBranch = fetchOpenPrs('waycool/CoolFocus', { exec });
  assert.equal(byBranch.get('feat-a').number, 1);
  assert.equal(byBranch.get('feat-b').rolled, 'draft');
  assert.equal(byBranch.size, 2);
});

test('fetchOpenPrs returns an empty map when gh fails instead of throwing', () => {
  const exec = () => ({ status: 1, stdout: '', stderr: 'gh: could not resolve repo' });
  assert.equal(fetchOpenPrs('waycool/Missing', { exec }).size, 0);
});

test('fetchBranchPr returns the single match or null', () => {
  const found = () => ({
    status: 0,
    stdout: JSON.stringify([
      { number: 10108, headRefName: 'wc-10196-fix', state: 'MERGED', statusCheckRollup: [] },
    ]),
    stderr: '',
  });
  assert.equal(fetchBranchPr('waycool/CoolFocus', 'wc-10196-fix', { exec: found }).rolled, 'merged');

  const empty = () => ({ status: 0, stdout: '[]', stderr: '' });
  assert.equal(fetchBranchPr('waycool/CoolFocus', 'nope', { exec: empty }), null);
});

test('fetchBranchPr uses the configured gh path', () => {
  let seen = null;
  const exec = (cmd) => {
    seen = cmd;
    return { status: 0, stdout: '[]', stderr: '' };
  };
  fetchBranchPr('o/n', 'b', { exec, ghPath: '/opt/homebrew/bin/gh' });
  assert.equal(seen, '/opt/homebrew/bin/gh');
});

const thread = (isResolved = false, viewerCanResolve = true) => ({ isResolved, viewerCanResolve });
const page = (nodes, endCursor = null) => ({
  reviewThreads: { nodes, pageInfo: { hasNextPage: endCursor !== null, endCursor } },
});
const response = (repository) => ({ status: 0, stdout: JSON.stringify({ data: { repository } }), stderr: '' });

test('thread counts batch PRs and count only unresolved threads the viewer can resolve', () => {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push({ cmd, args });
    return response({ pr1: page([thread(), thread(true), thread(false, false), { ...thread(), isOutdated: true }]), pr2: page([]) });
  };
  const counts = fetchResolvableThreads('github.example.com/o/n', [1, 2], { exec, ghPath: '/custom/gh' });
  assert.deepEqual([...counts], [[1, 2], [2, 0]]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, '/custom/gh');
  assert.match(calls[0].args.join(' '), /pr1: pullRequest/);
  assert.match(calls[0].args.join(' '), /pr2: pullRequest/);
  assert.ok(calls[0].args.includes('github.example.com'));
});

test('thread counts follow independent cursors past 100 threads', () => {
  let calls = 0;
  const exec = (cmd, args) => {
    calls++;
    if (calls === 1) return response({ pr1: page(Array.from({ length: 100 }, () => thread()), 'next-page'), pr2: page([thread()]) });
    const query = args.find((arg) => arg.startsWith('query='));
    assert.match(query, /after: "next-page"/);
    assert.doesNotMatch(query, /pr2:/);
    return response({ pr1: page([thread(), thread(true)]) });
  };
  assert.deepEqual([...fetchResolvableThreads('o/n', [1, 2], { exec })], [[1, 101], [2, 1]]);
  assert.equal(calls, 2);
});

test('thread query failures and incomplete pages stay unknown, preserving completed PR counts', () => {
  for (const failure of [
    { status: 1, stdout: '', stderr: 'offline' },
    { status: 0, stdout: 'invalid json', stderr: '' },
    { status: 0, stdout: JSON.stringify({ errors: [{ message: 'denied' }] }), stderr: '' },
    response({ pr1: page([thread()], 'next') }),
    response({ pr1: { reviewThreads: { nodes: [] } } }),
    response({ pr1: page([null]) }),
  ]) {
    let calls = 0;
    const exec = () => ++calls === 1 ? response({ pr1: page([thread()], 'next'), pr2: page([]) }) : failure;
    assert.deepEqual([...fetchResolvableThreads('o/n', [1, 2], { exec })], [[1, null], [2, 0]]);
    assert.equal(calls, 2);
  }
});

test('empty and terminal PR lists do not fetch threads', () => {
  assert.equal(fetchResolvableThreads('o/n', [], { exec: () => assert.fail('unexpected call') }).size, 0);
  let calls = 0;
  const exec = () => {
    calls++;
    return { status: 0, stdout: JSON.stringify([{ number: 1, headRefName: 'x', state: 'MERGED' }]), stderr: '' };
  };
  assert.equal(fetchBranchPr('o/n', 'x', { exec }).resolvableThreads, null);
  assert.equal(calls, 1);
});

test('all PR fetch paths attach thread counts without losing check status', () => {
  const raw = { number: 1, headRefName: 'x', state: 'OPEN', statusCheckRollup: [{ __typename: 'StatusContext', state: 'SUCCESS' }] };
  const exec = (cmd, args) => args[0] === 'api' ? response({ pr1: page([thread()]) }) :
    { status: 0, stdout: JSON.stringify(args[1] === 'view' ? raw : [raw]), stderr: '' };
  for (const pr of [fetchOpenPrs('o/n', { exec }).get('x'), fetchBranchPr('o/n', 'x', { exec }), fetchPrChecks('o/n', 1, { exec }).pr]) {
    assert.equal(pr.resolvableThreads, 1);
    assert.equal(pr.checks.state, 'pass');
  }
});
