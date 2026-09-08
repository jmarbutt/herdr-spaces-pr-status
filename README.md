# Spaces PR Status — a herdr plugin

Puts GitHub pull request status on your herdr spaces, and adds a PR board
grouped by where each branch actually stands.

```
▼ ● CoolFocus
    main
  ● WC-10202
    wc-10202-compliance-studio…
    ● #10110 · ✓ 28/28 · approved
    2 threads
  ○ WC-10200
    wc-10200-ultrasound-video…
    ◆ #10105 MERGED
  ◐ WC-10195
    wc-10195-allow-deleting…
    ⊗ #10125 · ✗ 1/26
```

The sidebar already tells you what your agents are doing. It says nothing about
where the branch stands on GitHub, so you end up alt-tabbing to check. This puts
open / checks running / checks failed / approved / merged next to the branch, and
adds a board when you want the whole picture at once.

## Requirements

- **herdr ≥ 0.7.4**
- **[`gh`](https://cli.github.com)**, authenticated (`gh auth status`). The plugin
  shells out to it, so it inherits your existing credentials.
- **Node.js ≥ 20.** No npm dependencies — nothing to install, no build step.
- GitHub only. GitLab and Bitbucket are not supported.

## Install

```bash
herdr plugin install jmarbutt/herdr-spaces-pr-status
```

Then add the token rows to `~/.config/herdr/config.toml`. **This part is
required** — without it the plugin reports status that nothing renders:

```toml
[ui.sidebar.spaces]
rows = [
  ["state_icon", "workspace"],
  ["branch", "git_status"],
  ["$pr", "$pr_checks", "$pr_review"],
  ["$pr_threads"],
]
```

```bash
herdr server reload-config
```

A row disappears entirely when none of its tokens have a value, so spaces
without a pull request cost no extra height.

The plugin starts polling on the next herdr server start. To see it immediately:

```bash
herdr plugin action invoke jmarbutt.spaces-pr-status.refresh
```

## Tokens

| Token | Example | Notes |
|---|---|---|
| `$pr` | `● #10110`, `◆ #10129 MERGED` | State glyph and PR number; merged, closed and draft also carry a word |
| `$pr_checks` | `✓ 28/28`, `✗ 2/14`, `… 5/13` | Hidden once merged or closed |
| `$pr_review` | `approved`, `changes req`, `review req` | Hidden once merged or closed |
| `$pr_threads` | `2 threads`, `1 thread`, `0 threads` | Unresolved review threads you can resolve; hidden when unknown, merged or closed |
| `$pr_diff` | `+914 -46` | Not in the recommended rows; add it if you want it |

State glyphs, `compact` (default) and `emoji`:

| State | compact | emoji |
|---|---|---|
| Open, checks green | ● | 🟢 |
| Checks running | ◐ | 🟡 |
| Checks failed | ⊗ | 🔴 |
| Draft | ◌ | ⚪ |
| Merged | ◆ | 🟣 |
| Closed | ⊘ | ⚫ |

Merged, closed and draft PRs also carry a word — `◆ #10129 MERGED`. The active
states do not, because their check counts already say what is going on; a lone
`◆` is a shape you have to remember.

`compact` is the default because herdr draws a space's own state as a
single-width `○`/`●` in the same row, and double-width emoji beside those read
as oversized. Colour is the trade: herdr strips control characters from token
values, so a token cannot carry colour of its own, and shape has to do the work.

Set `"style": "emoji"` if you would rather have colour. Emoji cost two cells per
glyph, so widen the sidebar to go with it:

```toml
[ui]
sidebar_max_width = 36
```

A full `glyph · #number · checks · review` row is around 32 columns, so it
truncates at the default 26. herdr auto-scales, so raising the maximum does not
force every space wide.

Thread counts include unresolved review threads that the authenticated GitHub
user can resolve (`isResolved: false` and `viewerCanResolve: true`), including
outdated threads. They count threads, not individual comments or review
requests. A known empty count shows `0 threads`; a failed or incomplete lookup
hides the count instead of claiming zero. The separate sidebar row avoids
crowding the PR status row. Existing installations must add `["$pr_threads"]`
to their sidebar rows to display it.

Check counts exclude skipped and cancelled checks. A repo that skips 20 of 43
workflows per PR reads as `✓ 23/23`, not `23/43`.

## Board

```bash
herdr plugin action invoke jmarbutt.spaces-pr-status.board
```

```
 Pull requests                                            7 spaces

 Checks failing                                                 1
   🔴 WC-10207       #10112                            +42 -74
 In review                                                      1
   🟢 WC-10202       #10110      approved             +914 -46
 Merged                                                         2
   🟣 WC-10200       #10105                            +173 -5
   🟣 WC-10203       #10109                           +489 -11
 No pull request                                                4
      planner
      WC-10192

 ↑↓ move · enter focus space · o open PR · r refresh · q quit
```

Groups with nothing in them are omitted. The board renders from cached state so
it opens instantly, then `r` refreshes. Active PR rows also show the resolvable thread count when
known and space permits.

## Checks panel

The sidebar tells you *that* checks are failing. This tells you *which*.

```bash
herdr plugin action invoke jmarbutt.spaces-pr-status.checks
```

```
 WC-10207
 🟡 #10112  +372 -2
 WC-10207: Catalog: Reports module…
 2 resolvable threads

 Failed 1
 🔴 PR Gate / .NET Build         3m
 Running 2
 🟡 Validate Entity Sync
 🟡 Vercel – coolfocus
 Passed 6
 🟢 PR Gate / Detect Changes    15s
 🟢 PR Gate / OpenAPI            6s
 🟢 PR Gate routing             10s
 Skipped 1
 ⚪ Detect env var changes

 r refresh · o open · q close
```

It shows the focused space's PR, grouped by what you can act on rather than by
provider — with a dozen checks the question is always "is anything broken, is
anything still running", and provider grouping answers neither. It refreshes
itself every 20 seconds while open. Each refresh fetches PR/check details and
review threads, with additional requests for thread pagination.

`checksPlacement` decides where it lands:

- `"split"` (default) — a side panel next to your work on desktop.
- `"tab"` — a tab on the space. **This is the one for mobile**, where herdr
  switches to a single-column layout below `mobile_width_threshold` and a split
  has nowhere to go.
- `"zoomed"` / `"overlay"` — full screen.

See [Keybindings](#keybindings) to put it one chord away.

## Keybindings

herdr already uses the unshifted `prefix+c`, `prefix+b`, `prefix+o` and
`prefix+r` (new tab, sidebar, notification, resize). These shift variants are
free in a stock herdr, so they collide with nothing:

```toml
[[keys.command]]
key = "prefix+shift+c"
type = "plugin_action"
command = "jmarbutt.spaces-pr-status.checks"
description = "this space's checks"

[[keys.command]]
key = "prefix+shift+b"
type = "plugin_action"
command = "jmarbutt.spaces-pr-status.board"
description = "PR board"

[[keys.command]]
key = "prefix+shift+o"
type = "plugin_action"
command = "jmarbutt.spaces-pr-status.open"
description = "open this space's PR"

[[keys.command]]
key = "prefix+shift+f"
type = "plugin_action"
command = "jmarbutt.spaces-pr-status.refresh"
description = "refresh PR status"
```

With the default `ctrl+b` prefix that is `ctrl+b` then `Shift+C` for the checks
panel, and so on. Function keys (`key = "f9"`) work too and need no prefix, but
on macOS they only reach herdr when "Use F1–F12 as standard function keys" is
on.

Actions: `refresh` (re-query everything, ignoring caches), `open` (open the
focused space's PR in a browser), `board`, `checks`.

`herdr config check` validates the TOML but does not confirm an action id
exists. To be sure a binding will fire, compare it against:

```bash
herdr plugin action list --plugin jmarbutt.spaces-pr-status
```

## Configure

`config.json` in the plugin config dir
(`herdr plugin config-dir jmarbutt.spaces-pr-status`). Every key is optional;
the plugin works with no config file at all.

```json
{
  "pollSeconds": 90,
  "style": "compact",
  "skipDefaultBranch": true,
  "repos": null,
  "notify": ["checks_failed", "review"],
  "noPrCacheSeconds": 180,
  "terminalCacheMinutes": 1440,
  "openPrLimit": 100,
  "ghPath": "gh",
  "checksPlacement": "split",
  "checksRefreshSeconds": 20
}
```

- `pollSeconds` — refresh interval, clamped to 15–3600. herdr events (new
  worktree, new space) trigger an immediate refresh regardless.
- `style` — `compact` (default, single-width shapes) or `emoji` (colour, double-width).
- `skipDefaultBranch` — leave the trunk space alone. A permanent "no PR" on
  `main` is noise. Falls back to `main`/`master` when `origin/HEAD` is unset.
- `repos` — allowlist like `["waycool/CoolFocus"]`. `null` means every repo.
- `notify` — any of `checks_failed`, `review`, `merged`. `[]` disables toasts.
- `noPrCacheSeconds` / `terminalCacheMinutes` — how long a "no PR" and a
  merged/closed result stay cached. Open PRs are never cached: their checks and
  review are exactly what changes between polls.
- `openPrLimit` — how many open PRs to fetch per repo in the batch query.
- `checksPlacement` — `split`, `tab`, `zoomed` or `overlay` for the checks
  panel. Use `tab` on mobile.
- `checksRefreshSeconds` — how often the checks panel re-reads GitHub while it
  is open, 5–600.

### API usage

One `gh pr list` call per repo per cycle covers every open PR. Branches that
miss that list get one targeted query each, then are cached — merged and closed
results for a day, "no PR" for three minutes. Nine spaces across one repo settles
at roughly two calls every 90 seconds: the PR list and a batched GraphQL review
thread lookup. Large thread lists require additional pages; targeted open PR
lookups also fetch their threads. Thread lookup failures leave PR/check status
available with the thread count unknown.

## Notifications

A toast fires only when both cycles saw the same PR on the same space and
something crossed a line: checks went red, a review decision landed, or the PR
merged. Opening a PR, losing one, and recovering from red are all silent. The
first cycle after a restart never notifies — otherwise every restart would toast
everything you already knew about.

## How it works

- `session.snapshot` lists spaces. Worktree spaces carry a checkout path; plain
  spaces fall back to their first pane's cwd, which is what lets an ordinary repo
  checkout show status too.
- `git rev-parse` and `git remote get-url` give branch and repo.
- `gh pr list` gives the PRs; GraphQL review threads provide resolvable counts.
- `workspace.report_metadata` writes the tokens, which
  `[ui.sidebar.spaces] rows` renders.

Tokens carry a TTL of four poll intervals. If the poller dies, its status expires
and the sidebar goes blank rather than showing something stale and wrong.

A `[[startup]]` hook launches the poller on server start and after a live
handoff, and a `worktree.created` hook re-checks it as a self-heal. herdr's
startup hooks are one-shot by design, so the plugin supervises its own poller
through a pid record keyed on the socket path.

## Troubleshooting

```bash
herdr plugin log list --plugin jmarbutt.spaces-pr-status
cat "$(herdr plugin config-dir jmarbutt.spaces-pr-status | sed 's#/config/#/state/#')/daemon.log"
herdr workspace list | grep -o '"tokens":{[^}]*}'
```

**Nothing in the sidebar.** The `[ui.sidebar.spaces] rows` block is required;
check `herdr config check`.

**A space shows nothing.** Expected when the branch has no PR, the space is on
the default branch, the remote is not GitHub, or the directory is not a git
repo. `herdr plugin action invoke jmarbutt.spaces-pr-status.refresh` prints how
many spaces resolved.

**Status stopped updating.** The poller probably died; tokens expire on their
own so the sidebar empties rather than lying. Restart it with a `refresh`
invoke or a new herdr server. If a stale pid record is confusing it, delete
`daemon.json` from the state dir.

## Develop

```bash
herdr plugin link /path/to/herdr-spaces-pr-status
npm test
```

No dependencies, so `npm install` is not needed. Tests are `node:test`.

## Licence

MIT
