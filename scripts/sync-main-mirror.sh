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

# Refresh remote state; offline/unreachable just skips (never blocks). The
# GIT_TERMINAL_PROMPT=0 guarantees a missing credential can never hang a session.
GIT_TERMINAL_PROMPT=0 git fetch origin --quiet 2>/dev/null || { echo "[sync-main] fetch skipped (offline/unreachable)"; exit 0; }

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
