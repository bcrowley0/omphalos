#!/usr/bin/env bash
# Launch this worktree's backend + frontend on a unique port pair.
#
# The port suffix is derived from the trailing number in the worktree
# directory name (no trailing number -> base ports, for the main checkout):
#   omphalos       -> backend :8000  frontend :3000
#   .worktrees/1   -> backend :8001  frontend :3001
#   .worktrees/2   -> backend :8002  frontend :3002
# This same script is copied into every worktree; it self-configures.
#
# Ctrl-C stops both servers.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
NAME="$(basename "$ROOT")"

# Extract a trailing number; default to 0 (base ports) for the main checkout.
if [[ "$NAME" =~ ([0-9]+)$ ]]; then
  N="${BASH_REMATCH[1]}"
else
  N=0
fi
BACKEND_PORT=$((8000 + N))
FRONTEND_PORT=$((3000 + N))

echo "[$NAME] backend  -> http://127.0.0.1:${BACKEND_PORT}"
echo "[$NAME] frontend -> http://localhost:${FRONTEND_PORT}"

# Frontend's Next rewrite must target THIS backend port.
export BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"

pids=()
cleanup() {
  echo
  echo "[$NAME] stopping..."
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Backend (uses the worktree's own venv).
(
  cd "$ROOT/api"
  exec .venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port "$BACKEND_PORT"
) &
pids+=($!)

# Frontend.
(
  cd "$ROOT/web"
  exec npm run dev -- -p "$FRONTEND_PORT"
) &
pids+=($!)

wait
