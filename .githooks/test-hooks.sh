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
  # Off main (feature branch) -> no-op even when origin is ahead.
  git -C "$d" checkout -q -b feat/y
  local off_before; off_before="$(git -C "$d" rev-parse main)"
  ( cd "$d" && git fetch -q origin && bash "$sync" >/dev/null 2>&1 )
  if [ "$(git -C "$d" rev-parse main)" = "$off_before" ]; then
    ok "sync no-ops when not on main"
  else
    bad "sync should not touch main when checked out elsewhere"
  fi
  rm -rf "$up" "$d"
}

test_pre_commit
test_pre_push
test_sync
echo "--- $pass passed, $fail failed ---"
[ "$fail" -eq 0 ]
