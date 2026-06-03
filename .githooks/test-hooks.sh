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
