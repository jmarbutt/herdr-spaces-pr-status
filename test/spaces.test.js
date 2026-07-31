import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spaceDirs, resolveSpaces } from '../lib/spaces.js';

// Trimmed from a real `herdr api snapshot`: a plain repo space, a worktree
// space, and a space with no worktree provenance whose directory has to come
// from its pane.
const SNAPSHOT = {
  workspaces: [
    {
      workspace_id: 'w3',
      label: 'CoolFocus',
      number: 1,
      worktree: {
        checkout_path: '/repos/CoolFocus',
        repo_root: '/repos/CoolFocus',
        repo_name: 'CoolFocus',
        repo_key: '/repos/CoolFocus/.git',
        is_linked_worktree: false,
      },
    },
    {
      workspace_id: 'w69',
      label: 'WC-10200',
      number: 3,
      worktree: {
        checkout_path: '/worktrees/CoolFocus/wc-10200-ultrasound',
        repo_root: '/repos/CoolFocus',
        repo_name: 'CoolFocus',
        repo_key: '/repos/CoolFocus/.git',
        is_linked_worktree: true,
      },
    },
    { workspace_id: 'w65', label: 'WayCool bot', number: 2 },
    { workspace_id: 'w99', label: 'Scratch', number: 9 },
  ],
  panes: [
    { pane_id: 'w3:p1', workspace_id: 'w3', cwd: '/repos/CoolFocus' },
    { pane_id: 'w65:p1', workspace_id: 'w65', cwd: '/repos/bot' },
    { pane_id: 'w65:p2', workspace_id: 'w65', cwd: '/repos/bot/src' },
  ],
};

test('spaceDirs prefers worktree checkout path, falls back to the first pane cwd', () => {
  const dirs = spaceDirs(SNAPSHOT);
  assert.deepEqual(
    dirs.map((d) => [d.workspace_id, d.dir]),
    [
      ['w3', '/repos/CoolFocus'],
      ['w69', '/worktrees/CoolFocus/wc-10200-ultrasound'],
      ['w65', '/repos/bot'],
    ],
  );
});

test('spaceDirs drops spaces with neither a worktree nor a pane cwd', () => {
  assert.ok(!spaceDirs(SNAPSHOT).some((d) => d.workspace_id === 'w99'));
});

test('spaceDirs carries the label and worktree flag through', () => {
  const dirs = spaceDirs(SNAPSHOT);
  const wt = dirs.find((d) => d.workspace_id === 'w69');
  assert.equal(wt.label, 'WC-10200');
  assert.equal(wt.isWorktree, true);
  assert.equal(dirs.find((d) => d.workspace_id === 'w65').isWorktree, false);
});

test('spaceDirs tolerates an empty snapshot', () => {
  assert.deepEqual(spaceDirs({}), []);
  assert.deepEqual(spaceDirs(null), []);
});

// A fake `git -C <dir> ...` so resolveSpaces stays a pure unit under test.
function fakeGit(byDir) {
  return (cmd, args) => {
    assert.equal(cmd, 'git');
    assert.equal(args[0], '-C');
    const dir = args[1];
    const entry = byDir[dir];
    if (!entry) return { status: 128, stdout: '', stderr: 'not a git repository' };
    const sub = args.slice(2).join(' ');
    if (sub.startsWith('rev-parse --abbrev-ref HEAD')) {
      return { status: 0, stdout: `${entry.branch}\n`, stderr: '' };
    }
    if (sub.startsWith('remote get-url')) {
      if (!entry.remote) return { status: 2, stdout: '', stderr: 'no such remote' };
      return { status: 0, stdout: `${entry.remote}\n`, stderr: '' };
    }
    if (sub.startsWith('symbolic-ref')) {
      if (!entry.defaultBranch) return { status: 1, stdout: '', stderr: '' };
      return { status: 0, stdout: `origin/${entry.defaultBranch}\n`, stderr: '' };
    }
    return { status: 1, stdout: '', stderr: `unexpected: ${sub}` };
  };
}

const GIT = {
  '/repos/CoolFocus': {
    branch: 'main',
    remote: 'git@github.com:waycool/CoolFocus.git',
    defaultBranch: 'main',
  },
  '/worktrees/CoolFocus/wc-10200-ultrasound': {
    branch: 'wc-10200-ultrasound',
    remote: 'git@github.com:waycool/CoolFocus.git',
    defaultBranch: 'main',
  },
  '/repos/bot': {
    branch: 'feature-x',
    remote: 'git@github.com:waycool/bot.git',
    defaultBranch: 'main',
  },
};

test('resolveSpaces returns repo and branch per space', () => {
  const spaces = resolveSpaces(SNAPSHOT, { exec: fakeGit(GIT), skipDefaultBranch: false });
  assert.deepEqual(
    spaces.map((s) => [s.workspace_id, s.repo, s.branch]),
    [
      ['w3', 'waycool/CoolFocus', 'main'],
      ['w69', 'waycool/CoolFocus', 'wc-10200-ultrasound'],
      ['w65', 'waycool/bot', 'feature-x'],
    ],
  );
});

test('resolveSpaces skips the default branch by default', () => {
  // A permanent "no PR" on main is noise, not information.
  const spaces = resolveSpaces(SNAPSHOT, { exec: fakeGit(GIT) });
  assert.deepEqual(spaces.map((s) => s.workspace_id), ['w69', 'w65']);
});

test('resolveSpaces skips detached HEAD', () => {
  const git = { ...GIT, '/repos/bot': { ...GIT['/repos/bot'], branch: 'HEAD' } };
  const spaces = resolveSpaces(SNAPSHOT, { exec: fakeGit(git), skipDefaultBranch: false });
  assert.ok(!spaces.some((s) => s.workspace_id === 'w65'));
});

test('resolveSpaces skips non-GitHub and missing remotes', () => {
  const git = {
    ...GIT,
    '/repos/bot': { branch: 'feature-x', remote: 'https://gitlab.com/group/sub/project.git' },
    '/worktrees/CoolFocus/wc-10200-ultrasound': {
      ...GIT['/worktrees/CoolFocus/wc-10200-ultrasound'],
      remote: null,
    },
  };
  const spaces = resolveSpaces(SNAPSHOT, { exec: fakeGit(git), skipDefaultBranch: false });
  assert.deepEqual(spaces.map((s) => s.workspace_id), ['w3']);
});

test('resolveSpaces skips directories that are not git repos', () => {
  const spaces = resolveSpaces(SNAPSHOT, { exec: fakeGit({}), skipDefaultBranch: false });
  assert.deepEqual(spaces, []);
});

test('resolveSpaces honours a repos allowlist', () => {
  const spaces = resolveSpaces(SNAPSHOT, {
    exec: fakeGit(GIT),
    skipDefaultBranch: false,
    repos: ['waycool/CoolFocus'],
  });
  assert.deepEqual(spaces.map((s) => s.workspace_id), ['w3', 'w69']);
});

test('resolveSpaces resolves the default branch once per repo root', () => {
  let symbolicRefCalls = 0;
  const counting = (cmd, args) => {
    if (args.slice(2).join(' ').startsWith('symbolic-ref')) symbolicRefCalls += 1;
    return fakeGit(GIT)(cmd, args);
  };
  resolveSpaces(SNAPSHOT, { exec: counting });
  // Two CoolFocus spaces share one repo root, so two lookups total, not three.
  assert.equal(symbolicRefCalls, 2);
});

test('resolveSpaces falls back to conventional trunk names when origin/HEAD is unset', () => {
  // Real checkouts often have no refs/remotes/origin/HEAD at all.
  const noHead = {
    '/repos/CoolFocus': { branch: 'main', remote: 'git@github.com:waycool/CoolFocus.git' },
    '/worktrees/CoolFocus/wc-10200-ultrasound': {
      branch: 'wc-10200-ultrasound',
      remote: 'git@github.com:waycool/CoolFocus.git',
    },
    '/repos/bot': { branch: 'master', remote: 'git@github.com:waycool/bot.git' },
  };
  const spaces = resolveSpaces(SNAPSHOT, { exec: fakeGit(noHead) });
  assert.deepEqual(spaces.map((s) => s.workspace_id), ['w69']);
});

test('resolveSpaces keeps a non-trunk branch when origin/HEAD is unset', () => {
  const noHead = {
    '/repos/bot': { branch: 'feature-x', remote: 'git@github.com:waycool/bot.git' },
  };
  const spaces = resolveSpaces(SNAPSHOT, { exec: fakeGit(noHead) });
  assert.deepEqual(spaces.map((s) => s.workspace_id), ['w65']);
});

test('resolveSpaces groups spaces by repo for batched querying', () => {
  const spaces = resolveSpaces(SNAPSHOT, { exec: fakeGit(GIT), skipDefaultBranch: false });
  const repos = new Set(spaces.map((s) => s.repo));
  assert.deepEqual([...repos].sort(), ['waycool/CoolFocus', 'waycool/bot']);
});
