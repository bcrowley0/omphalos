#!/usr/bin/env bash
# Create a new dev worktree that "just works" with go.sh / dev.sh, without
# touching any currently-running worktree.
#
# Each worktree self-configures its ports from the trailing number in its
# directory name (see dev.sh):
#   .worktrees/4 -> backend :8004  frontend :3004
#
# Usage:
#   ./new-worktree.sh            # auto-pick the next free number
#   ./new-worktree.sh 7          # use a specific number
#   ./new-worktree.sh --fast [N] # hardlink-copy node_modules instead of npm install (near-instant)
#
# Steps performed (matching the proven manual setup):
#   1. git worktree add .worktrees/<N> -b feat/work-<N>
#   2. ensure dev.sh is present (tracked -> auto-checked-out) and copy go.sh if local
#   3. symlink api/.venv -> the main checkout's shared venv
#   4. provide web/node_modules (real npm install by default; --fast hardlink-copies it)
#
# NOTE: node_modules must NOT be a symlink — Next's Turbopack rejects a symlinked
# node_modules ("points out of the filesystem root"). --fast uses `cp -al`
# (hardlinks), which stays inside the worktree so Turbopack sees real files while
# sharing disk with the main checkout.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$ROOT"

# dev.sh is tracked, so it's checked out into every new worktree automatically;
# this script just needs it present in the main checkout to fall back on.
[ -f "$ROOT/dev.sh" ] || { echo "error: dev.sh not found next to this script ($ROOT)"; exit 1; }

FAST=0
N=""
for arg in "$@"; do
  case "$arg" in
    --fast) FAST=1 ;;
    ''|*[!0-9]*) echo "error: unknown argument '$arg' (expected a number or --fast)"; exit 1 ;;
    *) N="$arg" ;;
  esac
done

# Auto-pick the next free number: max existing trailing number + 1 (min 1).
if [ -z "$N" ]; then
  max=0
  if [ -d "$ROOT/.worktrees" ]; then
    for d in "$ROOT"/.worktrees/*/; do
      name="$(basename "$d")"
      [[ "$name" =~ ^[0-9]+$ ]] || continue
      (( name > max )) && max="$name"
    done
  fi
  N=$((max + 1))
fi

WT="$ROOT/.worktrees/$N"
BRANCH="feat/work-$N"
BACKEND_PORT=$((8000 + N))
FRONTEND_PORT=$((3000 + N))

# Refuse to clobber anything that already exists.
[ -e "$WT" ] && { echo "error: $WT already exists — pick a different number"; exit 1; }
if git -C "$ROOT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "error: branch $BRANCH already exists — pick a different number"; exit 1
fi

echo "[new-worktree] creating .worktrees/$N  (branch $BRANCH, backend :$BACKEND_PORT, frontend :$FRONTEND_PORT)"

# 1. New worktree on a fresh branch off the current HEAD.
git -C "$ROOT" worktree add "$WT" -b "$BRANCH"

# 2. Launchers. dev.sh is tracked, so `git worktree add` already checked it out;
#    just guarantee it's present + executable. go.sh is local-only (personal
#    tmux/claude launcher) — copy it in if this checkout has one.
[ -f "$WT/dev.sh" ] || cp "$ROOT/dev.sh" "$WT/dev.sh"
chmod +x "$WT/dev.sh"
if [ -f "$ROOT/go.sh" ]; then
  cp "$ROOT/go.sh" "$WT/go.sh"
  chmod +x "$WT/go.sh"
fi

# 3. Share the main checkout's venv via symlink (read-only v1; deps are stable).
ln -sfn "$ROOT/api/.venv" "$WT/api/.venv"

# 4. node_modules. Must be real files, not a symlink (Turbopack rejects a
#    symlinked node_modules). --fast hardlink-copies the main checkout's tree.
if [ "$FAST" -eq 1 ]; then
  echo "[new-worktree] hardlink-copying web/node_modules from main checkout (cp -al)..."
  rm -rf "$WT/web/node_modules"
  cp -al "$ROOT/web/node_modules" "$WT/web/node_modules"
else
  echo "[new-worktree] installing web dependencies (npm install)..."
  ( cd "$WT/web" && npm install )
fi

cat <<EOF

[new-worktree] done. Start it with:

    cd $WT && ./go.sh        # tmux: servers (logs) + Claude
    # or just the servers:
    cd $WT && ./dev.sh       # backend :$BACKEND_PORT, frontend :$FRONTEND_PORT

Remove it later with:
    git worktree remove $WT && git branch -D $BRANCH
EOF
