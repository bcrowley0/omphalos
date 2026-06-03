# Main Read-Only Mirror Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the main checkout's `main` branch a read-only mirror of `origin/main` so the concurrent-checkout hazard (stale `main`, racing direct pushes) becomes impossible.

**Architecture:** Committed git hooks reject commits on `main` and direct pushes to `origin/main` (Layer 1); a fail-safe `SessionStart` script fast-forwards local `main` to `origin/main` and self-installs `core.hooksPath` (Layer 2); optional server-side GitHub branch protection (Layer 3). All work happens in `worktree-feat+main-mirror-guardrails`, shipped as one PR.

**Tech Stack:** POSIX/bash shell, git hooks (`pre-commit`, `pre-push`), Claude Code `SessionStart` hook in `.claude/settings.json`, `gh` CLI for Layer 3.

---

## File Structure

- `.githooks/pre-commit` — reject any commit while on branch `main`.
- `.githooks/pre-push` — reject any push whose target ref is `refs/heads/main`.
- `.githooks/test-hooks.sh` — self-contained shell test harness (temp repos, no network) for all three scripts.
- `scripts/sync-main-mirror.sh` — fail-safe fast-forward sync + idempotent `core.hooksPath` install.
- `.claude/settings.json` — `SessionStart` hook invoking the sync script (new file; none exists today).
- `CLAUDE.md` — extend the **Worktree execution model** section: the rule is now enforced, not just documented.
- `README.md` — one line documenting the read-only-mirror model for human clones.

Note: hooks live in committed `.githooks/` (not `.git/hooks/`) so they travel with every checkout; `core.hooksPath` activates them and is set by the sync script and the README bootstrap line.

---

## Task 1: Test harness + pre-commit hook

**Files:**
- Create: `.githooks/test-hooks.sh`
- Create: `.githooks/pre-commit`

- [ ] **Step 1: Write the failing test harness with the pre-commit case**

Create `.githooks/test-hooks.sh`:

```bash
#!/usr/bin/env bash
# Self-contained tests for the read-only-mirror guardrails. No network.
# Each test builds a throwaway git repo in a temp dir and exercises one script.
set -uo pipefail

HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$HOOKS_DIR/.." && pwd -P)"
pass=0 fail=0
ok()   { echo "  ok   - $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL - $1"; fail=$((fail+1)); }

# A fresh repo whose hooksPath points at our real .githooks dir.
new_repo() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q
  git -C "$d" config user.email t@t.t
  git -C "$d" config user.name t
  git -C "$d" config core.hooksPath "$REPO_ROOT/.githooks"
  git -C "$d" checkout -q -b main
  echo seed > "$d/seed"; git -C "$d" add seed
  # First commit must bypass the hook (no parent yet); use --no-verify.
  git -C "$d" commit -q --no-verify -m seed
  echo "$d"
}

test_pre_commit() {
  local d; d="$(new_repo)"
  echo x > "$d/f"; git -C "$d" add f
  if git -C "$d" commit -q -m "on main" 2>/dev/null; then
    bad "pre-commit should reject a commit on main"
  else
    ok "pre-commit rejects a commit on main"
  fi
  git -C "$d" checkout -q -b feat/x
  echo y > "$d/g"; git -C "$d" add g
  if git -C "$d" commit -q -m "on feat" 2>/dev/null; then
    ok "pre-commit allows a commit on feat/x"
  else
    bad "pre-commit should allow a commit on feat/x"
  fi
  rm -rf "$d"
}

test_pre_commit
echo "--- $pass passed, $fail failed ---"
[ "$fail" -eq 0 ]
```

- [ ] **Step 2: Run the harness to verify it fails (hook missing)**

Run: `chmod +x .githooks/test-hooks.sh && ./.githooks/test-hooks.sh`
Expected: FAIL — "pre-commit should reject a commit on main" (no hook exists yet, so the commit succeeds).

- [ ] **Step 3: Write the pre-commit hook**

Create `.githooks/pre-commit`:

```bash
#!/usr/bin/env bash
# Reject commits on `main`: it is a read-only mirror of origin/main.
set -uo pipefail
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo)"
if [ "$branch" = "main" ]; then
  echo "pre-commit: 'main' is a read-only mirror of origin/main." >&2
  echo "  Run ./new-worktree.sh, commit there, and integrate via PR." >&2
  exit 1
fi
exit 0
```

- [ ] **Step 4: Run the harness to verify it passes**

Run: `chmod +x .githooks/pre-commit && ./.githooks/test-hooks.sh`
Expected: PASS — "2 passed, 0 failed".

- [ ] **Step 5: Commit**

```bash
git add .githooks/pre-commit .githooks/test-hooks.sh
git commit -m "feat(githooks): reject commits on main (read-only mirror)"
```

---

## Task 2: pre-push hook

**Files:**
- Create: `.githooks/pre-push`
- Modify: `.githooks/test-hooks.sh`

- [ ] **Step 1: Add the failing pre-push test**

In `.githooks/test-hooks.sh`, add this function and call it before the summary line (`echo "--- ..."`):

```bash
test_pre_push() {
  # pre-push reads quad lines on stdin: <local ref> <sha> <remote ref> <sha>.
  local hook="$REPO_ROOT/.githooks/pre-push"
  local z=0000000000000000000000000000000000000000
  if printf 'refs/heads/main %s refs/heads/main %s\n' "$z" "$z" \
       | "$hook" origin https://example/x >/dev/null 2>&1; then
    bad "pre-push should reject a push targeting refs/heads/main"
  else
    ok "pre-push rejects a push targeting refs/heads/main"
  fi
  if printf 'refs/heads/feat/x %s refs/heads/feat/x %s\n' "$z" "$z" \
       | "$hook" origin https://example/x >/dev/null 2>&1; then
    ok "pre-push allows a push targeting a feature branch"
  else
    bad "pre-push should allow a push targeting a feature branch"
  fi
}
test_pre_push
```

- [ ] **Step 2: Run the harness to verify the new case fails**

Run: `./.githooks/test-hooks.sh`
Expected: FAIL — "pre-push should reject a push targeting refs/heads/main" (no hook file yet; piping to a missing file errors, but the success-branch assertion for the feature case also can't pass — harness reports failures).

- [ ] **Step 3: Write the pre-push hook**

Create `.githooks/pre-push`:

```bash
#!/usr/bin/env bash
# Reject direct pushes to main on any remote. Integrate via PR instead.
set -uo pipefail
# stdin: <local ref> <local sha> <remote ref> <remote sha>, one line per ref.
while read -r local_ref local_sha remote_ref remote_sha; do
  if [ "$remote_ref" = "refs/heads/main" ]; then
    echo "pre-push: direct push to main is forbidden — integrate via PR." >&2
    exit 1
  fi
done
exit 0
```

- [ ] **Step 4: Run the harness to verify it passes**

Run: `chmod +x .githooks/pre-push && ./.githooks/test-hooks.sh`
Expected: PASS — "4 passed, 0 failed".

- [ ] **Step 5: Commit**

```bash
git add .githooks/pre-push .githooks/test-hooks.sh
git commit -m "feat(githooks): reject direct pushes to origin/main"
```

---

## Task 3: sync-main-mirror.sh (fast-forward + hooksPath self-install)

**Files:**
- Create: `scripts/sync-main-mirror.sh`
- Modify: `.githooks/test-hooks.sh`

- [ ] **Step 1: Add the failing sync tests**

In `.githooks/test-hooks.sh`, add this function and call it before the summary line. It builds a local "origin" so no network is used:

```bash
test_sync() {
  local sync="$REPO_ROOT/scripts/sync-main-mirror.sh"
  # Build an upstream repo with an extra commit, and a clone behind it.
  local up; up="$(mktemp -d)"
  git -C "$up" init -q -b main
  git -C "$up" config user.email t@t.t; git -C "$up" config user.name t
  echo a > "$up/a"; git -C "$up" add a; git -C "$up" commit -q --no-verify -m a
  local d; d="$(mktemp -d)"
  git -C "$d" clone -q "$up" .  2>/dev/null || git clone -q "$up" "$d"
  git -C "$d" config user.email t@t.t; git -C "$d" config user.name t
  # Advance upstream so the clone's main is strictly behind origin/main.
  echo b > "$up/b"; git -C "$up" add b; git -C "$up" commit -q --no-verify -m b

  # Behind + clean + on main -> fast-forwards.
  ( cd "$d" && git fetch -q origin && bash "$sync" >/dev/null 2>&1 )
  if [ "$(git -C "$d" rev-parse main)" = "$(git -C "$up" rev-parse main)" ]; then
    ok "sync fast-forwards a clean main that is behind origin/main"
  else
    bad "sync should fast-forward a clean main that is behind"
  fi
  # Self-installed hooksPath.
  if [ "$(git -C "$d" config --get core.hooksPath)" = ".githooks" ]; then
    ok "sync self-installs core.hooksPath=.githooks"
  else
    bad "sync should set core.hooksPath=.githooks"
  fi
  # Dirty tree -> no-op (advance upstream again first).
  echo c > "$up/c"; git -C "$up" add c; git -C "$up" commit -q --no-verify -m c
  echo dirty > "$d/dirty"
  local before; before="$(git -C "$d" rev-parse main)"
  ( cd "$d" && git fetch -q origin && bash "$sync" >/dev/null 2>&1 )
  if [ "$(git -C "$d" rev-parse main)" = "$before" ]; then
    ok "sync no-ops on a dirty working tree"
  else
    bad "sync should not touch main when the tree is dirty"
  fi
  rm -rf "$up" "$d"
}
test_sync
```

- [ ] **Step 2: Run the harness to verify the sync cases fail**

Run: `./.githooks/test-hooks.sh`
Expected: FAIL — "sync should fast-forward a clean main that is behind" (script does not exist yet).

- [ ] **Step 3: Write the sync script**

Create `scripts/sync-main-mirror.sh`:

```bash
#!/usr/bin/env bash
# Keep the main checkout's `main` a read-only fast-forward mirror of origin/main.
# Fail-safe: never blocks a session, only fast-forwards a clean main that is
# strictly behind origin/main. Never merges, never resets.
set -uo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$root" || exit 0

# Layer-1 self-install: make sure the committed hooks are active.
if [ "$(git config --get core.hooksPath 2>/dev/null || echo)" != ".githooks" ]; then
  git config core.hooksPath .githooks
fi

# Refresh remote state; offline just skips (never blocks).
git fetch origin --quiet 2>/dev/null || { echo "[sync-main] fetch skipped (offline?)"; exit 0; }

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo)"
[ "$branch" = "main" ] || { echo "[sync-main] not on main ($branch) — nothing to sync"; exit 0; }
if [ -n "$(git status --porcelain)" ]; then
  echo "[sync-main] working tree dirty — leaving main untouched"; exit 0
fi
git rev-parse --verify -q origin/main >/dev/null || { echo "[sync-main] no origin/main"; exit 0; }

local_sha="$(git rev-parse main)"
remote_sha="$(git rev-parse origin/main)"
[ "$local_sha" = "$remote_sha" ] && { echo "[sync-main] main already up to date"; exit 0; }

# Fast-forward only: origin/main must descend from local main.
if git merge-base --is-ancestor "$local_sha" "$remote_sha"; then
  git merge --ff-only origin/main --quiet \
    && echo "[sync-main] fast-forwarded main -> $(git rev-parse --short origin/main)"
else
  echo "[sync-main] main diverged from origin/main — NOT auto-syncing; inspect manually" >&2
fi
exit 0
```

- [ ] **Step 4: Run the harness to verify it passes**

Run: `chmod +x scripts/sync-main-mirror.sh && ./.githooks/test-hooks.sh`
Expected: PASS — "7 passed, 0 failed".

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-main-mirror.sh .githooks/test-hooks.sh
git commit -m "feat(scripts): fast-forward main-mirror sync with hooksPath self-install"
```

---

## Task 4: Wire the SessionStart hook

**Files:**
- Create: `.claude/settings.json`

- [ ] **Step 1: Create the settings file with the SessionStart hook**

Create `.claude/settings.json` (no settings file exists today, so this is the whole file):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash scripts/sync-main-mirror.sh"
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Validate the JSON**

Run: `python3 -c "import json;json.load(open('.claude/settings.json'));print('valid')"`
Expected: `valid`

- [ ] **Step 3: Dry-run the hook command from the worktree**

Run: `bash scripts/sync-main-mirror.sh`
Expected: a single line like `[sync-main] not on main (worktree-feat+main-mirror-guardrails) — nothing to sync` (proves the script is fail-safe off `main` and exits 0). Confirm exit status:
Run: `bash scripts/sync-main-mirror.sh; echo "exit=$?"`
Expected: `exit=0`

- [ ] **Step 4: Commit**

```bash
git add .claude/settings.json
git commit -m "feat(claude): run main-mirror sync on SessionStart"
```

---

## Task 5: Documentation pointers

**Files:**
- Modify: `CLAUDE.md` (the **Worktree execution model** section)
- Modify: `README.md`

- [ ] **Step 1: Extend the CLAUDE.md worktree section**

In `CLAUDE.md`, find the line in the **Worktree execution model** section that ends `...integrate via PR off origin/main in a fresh worktree.` and append this paragraph immediately after it:

```markdown
This is now **enforced**, not just convention: `main` is a read-only mirror of
`origin/main`. Committed git hooks (`.githooks/`, via `core.hooksPath`) reject
commits on `main` and direct pushes to `origin/main`; a `SessionStart` hook runs
`scripts/sync-main-mirror.sh`, which fast-forwards local `main` to `origin/main`
(fast-forward only, never a merge) and self-installs `core.hooksPath`. Do all
work in a worktree.
```

- [ ] **Step 2: Add the README bootstrap line**

In `README.md`, locate the development/worktree setup section (search for `new-worktree.sh`). Immediately after the paragraph that introduces worktrees, add:

```markdown
**`main` is a read-only mirror of `origin/main`.** Never commit to `main` or push
to it directly — git hooks reject both. Work in a worktree (`./new-worktree.sh`)
and integrate via PR. Hooks activate via `git config core.hooksPath .githooks`
(the `SessionStart` hook sets this automatically; set it once manually for a
plain clone).
```

If no `new-worktree.sh` reference exists in `README.md`, add the paragraph under the existing "Development" / "Getting started" heading instead.

- [ ] **Step 3: Verify the edits landed**

Run: `grep -n "read-only mirror" CLAUDE.md README.md`
Expected: at least one match in each file.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document the enforced main read-only mirror"
```

---

## Task 6: Layer 3 — GitHub branch protection (verify, then apply if available)

**Files:** none (remote configuration via `gh`).

- [ ] **Step 1: Check availability and current rules**

Run: `gh api repos/bcrowley0/omphalos/rulesets 2>&1 | head -20`
Also run: `gh api repos/bcrowley0/omphalos --jq '.private,.permissions.admin' 2>&1`
Expected: confirms admin access and whether rulesets are usable on this plan.

- [ ] **Step 2: If available, create a ruleset requiring PRs for `main`**

Run (only if Step 1 shows rulesets are usable):

```bash
gh api -X POST repos/bcrowley0/omphalos/rulesets \
  -f name='protect-main' -f target='branch' -f enforcement='active' \
  -F 'conditions[ref_name][include][]=refs/heads/main' \
  -F 'conditions[ref_name][exclude][]=' \
  -F 'rules[][type]=pull_request' \
  -F 'rules[][type]=non_fast_forward'
```

Expected: HTTP 201 with the ruleset JSON.

- [ ] **Step 3: Verify enforcement**

Run: `gh api repos/bcrowley0/omphalos/rulesets --jq '.[].name'`
Expected: includes `protect-main`.

- [ ] **Step 4: If NOT available, record a follow-up**

If Step 1 shows rulesets are unavailable on this plan, do not fail the task. Append a note to the PR description: *"Layer 3 (server-side branch protection) unavailable on current repo plan; Layers 1–2 enforce locally."* Layers 1–2 fully cover the local hazard.

---

## Task 7: End-to-end verification from the real main checkout

**Files:** none (manual verification; do this in `/home/brian/omphalos`, NOT the worktree).

- [ ] **Step 1: Activate hooks in the main checkout**

Run: `git -C /home/brian/omphalos config core.hooksPath .githooks`
(After this PR merges, the SessionStart hook does this automatically; we set it now to test.)
Note: `.githooks/` must exist on the checked-out branch — run this step only after the PR is merged to `main`, or temporarily check out this branch's `.githooks` dir.

- [ ] **Step 2: Confirm a commit on main is rejected**

Run: `cd /home/brian/omphalos && echo x >> README.md && git add README.md && git commit -m "should fail"`
Expected: rejected with `pre-commit: 'main' is a read-only mirror...`. Then clean up: `git checkout -- README.md`.

- [ ] **Step 3: Confirm a direct push to main is rejected**

Run: `cd /home/brian/omphalos && git push origin main`
Expected: rejected with `pre-push: direct push to main is forbidden...` (no commits are sent).

- [ ] **Step 4: Confirm the sync fast-forwards a stale main**

With local `main` behind `origin/main`, run: `bash /home/brian/omphalos/scripts/sync-main-mirror.sh`
Expected: `[sync-main] fast-forwarded main -> <sha>` and `git -C /home/brian/omphalos rev-parse main` now equals `origin/main`.

---

## Self-Review

**Spec coverage:** Layer 1 → Tasks 1–2; Layer 2 → Tasks 3–4; Layer 3 → Task 6; docs (`CLAUDE.md`, `README.md`) → Task 5; testing strategy → `test-hooks.sh` grown across Tasks 1–3; manual verification → Task 7. All spec sections map to a task.

**Placeholder scan:** every code/command step contains literal content; no TBD/TODO/"handle edge cases".

**Type/name consistency:** `core.hooksPath=.githooks`, `scripts/sync-main-mirror.sh`, and the `[sync-main]` / `pre-commit:` / `pre-push:` message prefixes are identical everywhere they appear across tasks and docs.
