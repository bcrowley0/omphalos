#!/usr/bin/env bash
# Ship the current worktree branch to main in one shot:
#   stage -> commit -> push -> open PR -> squash-merge into main.
#
# Per the project's integration rule (never local-merge into main), the merge
# is performed by GitHub via `gh pr merge`, not a local `git merge`.
#
# Usage:
#   ./ship.sh "feat(web): add color themes"     # full flow, ending in a merge
#   ./ship.sh "msg" --no-merge                   # stop after opening the PR
#
# Safe to re-run: skips the commit when there's nothing staged, and skips
# `gh pr create` when a PR already exists for the branch.
set -euo pipefail

MSG=""
MERGE=1
for arg in "$@"; do
  case "$arg" in
    --no-merge) MERGE=0 ;;
    -*) echo "error: unknown flag '$arg'"; exit 1 ;;
    *) MSG="$arg" ;;
  esac
done

[ -n "$MSG" ] || { echo "error: commit message required, e.g. ./ship.sh \"feat: ...\""; exit 1; }

branch="$(git branch --show-current)"
[ "$branch" = "main" ] && { echo "error: refusing to ship from main — work on a worktree branch"; exit 1; }

# 1-2. Stage + commit (only if there's anything to commit).
if [ -n "$(git status --porcelain)" ]; then
  echo "[ship] committing changes on $branch"
  git add -A
  git commit -m "$MSG"
else
  echo "[ship] working tree clean — nothing new to commit"
fi

# 3. Push the branch (sets upstream on first push).
echo "[ship] pushing $branch -> origin"
git push -u origin "$branch"

# 4. Open a PR into main, or reuse the existing one. --fill writes the title/body
#    from the commit(s).
if gh pr view "$branch" >/dev/null 2>&1; then
  echo "[ship] PR already open for $branch"
else
  echo "[ship] opening PR into main"
  gh pr create --base main --fill
fi

# 5. Merge (GitHub-side squash), unless --no-merge.
if [ "$MERGE" -eq 1 ]; then
  echo "[ship] squash-merging PR into main"
  gh pr merge "$branch" --squash
  git push origin --delete "$branch" 2>/dev/null || true
  cat <<EOF

[ship] merged into main; remote branch deleted.
Remove this worktree when done (run from the MAIN checkout, not here):
    git worktree remove "$PWD" && git branch -D "$branch"
EOF
else
  echo "[ship] PR is open; merge it on GitHub when ready (re-run without --no-merge to auto-merge)."
fi
