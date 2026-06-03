# Main read-only mirror guardrails — design

**Date:** 2026-06-02
**Status:** Approved (pending spec review)

## Goal

Eliminate the **concurrent-checkout hazard**: the main checkout
(`/home/brian/omphalos`) runs its own Claude instance (via `go.sh`, right tmux
pane) alongside per-worktree Claude instances, all sharing one `.git`. The main
checkout sits on `main`, which silently goes **stale** as PRs merge to
`origin/main`, and a direct local commit/merge/push to `main` can **race** the
other agents and corrupt shared history.

The fix makes `main` a **read-only mirror of `origin/main`**: nothing ever
commits to `main` locally; the main checkout's only job is to stay synced to
`origin/main`; every change — including the main-checkout agent's — goes through
a worktree + PR. The hazard becomes structurally impossible (or at least
actively rejected), not merely a documented convention.

## Non-goals (YAGNI)

- No change to the worktree model itself (`new-worktree.sh`, port scheme,
  `dev.sh`/`go.sh`). Those already work; we only add guardrails around `main`.
- No Claude Code `PreToolUse` Bash-matching hook. Git hooks catch the operation
  at the git layer regardless of who triggers it; string-matching Bash commands
  is fragile (misses aliases, `git merge`, scripts) and redundant.
- No automatic creation of worktrees or PRs. The guardrails *block the wrong
  thing* and *keep the mirror fresh*; choosing what to build stays manual.
- No rewrite of history, no force-push tooling, no multi-remote support.

## Architecture — three layers (defense in depth)

### Layer 1 — Committed git hooks (the core)

A tracked `.githooks/` directory plus `core.hooksPath=.githooks`:

- **`pre-commit`** — if the current branch is `main`, reject the commit with a
  clear message:
  > `main is a read-only mirror of origin/main. Run ./new-worktree.sh and commit there.`
- **`pre-push`** — inspect the refs being pushed (read from stdin, the standard
  pre-push protocol: `<local-ref> <local-sha> <remote-ref> <remote-sha>`); if any
  `remote-ref` is `refs/heads/main`, reject:
  > `Direct push to origin/main is forbidden. Integrate via PR.`

Rationale for git-layer over Claude hooks: it guards **every** actor on the
machine — the main-checkout agent, you at a shell, a worktree agent, a stray
script. The git common config is shared across all worktrees, and `.githooks/`
is committed so it travels with every checkout.

Worktree interaction: only the main checkout is ever on `main` (worktrees live
on `feat/*` / `worktree-*` branches), so the `pre-commit` branch check is a
no-op there and never impedes normal worktree work.

### Layer 2 — Auto-sync the mirror (fixes the root cause)

A small script `scripts/sync-main-mirror.sh` and a `SessionStart` hook in
`.claude/settings.json` that runs it:

1. Ensure `core.hooksPath` is set to `.githooks` (idempotent self-install of
   Layer 1, so a fresh clone is protected on first session).
2. `git fetch origin --quiet`.
3. **Only if** the current checkout is on `main`, the working tree is clean, and
   local `main` is **strictly behind** `origin/main` (i.e. a true fast-forward):
   fast-forward local `main` to `origin/main` (`git merge --ff-only` or
   `update-ref`). Never a real merge; never touched if there are local commits
   (Layer 1 prevents those anyway) or a dirty tree.

This is the **only** write to `main`, and it is a safe fast-forward to the
mirror's upstream — exactly what "read-only mirror" means. It guarantees every
session starts on fresh `main` instead of a stale snapshot.

### Layer 3 — GitHub branch protection (server-side, if available)

A ruleset on `origin` requiring a PR and blocking direct pushes to `main`. This
is the only layer that cannot be bypassed from another machine or by unsetting
local config. Availability depends on the repo plan — the implementation will
**verify** via `gh` first; if unavailable, Layers 1–2 still fully cover the
local hazard and Layer 3 is recorded as a manual follow-up.

## Data flow / control flow

```
session start ──> SessionStart hook ──> sync-main-mirror.sh
                                          ├─ ensure core.hooksPath=.githooks
                                          ├─ git fetch origin
                                          └─ on main & clean & behind? ff-only

commit attempt on main ──> .githooks/pre-commit ──> REJECT (exit 1, message)
push to origin main    ──> .githooks/pre-push   ──> REJECT (exit 1, message)
push to origin <feat>  ──> .githooks/pre-push   ──> allow
```

## Error handling

- All hook/script failures are **fail-safe and quiet on the happy path**:
  - `sync-main-mirror.sh` must **never block a session** — if `git fetch` fails
    (offline), or the tree is dirty, or not on `main`, it logs one line and
    exits 0. It never fast-forwards a dirty or diverged tree.
  - Hooks exit non-zero **only** to block the specific forbidden action, with a
    one-line reason on stderr telling the user what to do instead.
- The sync is fast-forward-only: if `main` has somehow diverged (local commits
  that Layer 1 should have prevented), it does **not** merge or reset — it logs
  the divergence and leaves `main` untouched for human inspection.

## Testing

A `bats` (or plain shell) test script `.githooks/test-hooks.sh` exercised in a
throwaway temp git repo (no network):

- `pre-commit` rejects a commit on `main`, allows one on `feat/x`.
- `pre-push` rejects a push spec targeting `refs/heads/main`, allows one
  targeting `refs/heads/feat/x` (feed it the documented stdin format).
- `sync-main-mirror.sh`: with a local `main` set behind a fake `origin/main`,
  asserts it fast-forwards; with a dirty tree, asserts it no-ops; off `main`,
  asserts it no-ops.

Manual verification: from the main checkout, attempt `git commit` on `main` and
`git push origin main` — both rejected with the documented messages.

## Files touched

- `.githooks/pre-commit` *(new)*
- `.githooks/pre-push` *(new)*
- `.githooks/test-hooks.sh` *(new)*
- `scripts/sync-main-mirror.sh` *(new)*
- `.claude/settings.json` *(new)* — `SessionStart` hook invoking the sync script
- `CLAUDE.md` — short pointer in the **Worktree execution model** section noting
  the guardrails now enforce the rule (mirror + hooks), not just document it.
- `README.md` — one line on the read-only-mirror model for human contributors.

## Rollout / bootstrap

`core.hooksPath` is repo-local config (not committed), so it is set by:
1. the Layer-2 SessionStart hook (idempotent), and
2. a one-time note in the README for non-Claude clones.

Because worktrees share the common git dir, setting it once protects every
existing and future worktree.
