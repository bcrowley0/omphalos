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

# 4. Open a PR into main, or reuse an *open* one for this branch. --fill writes
#    the title/body from the commit(s). We match only OPEN PRs by number — a
#    reused branch name (worktrees recycle names) may have an old merged/closed
#    PR, and `gh pr view <branch>` would wrongly return that stale one.
open_pr() { gh pr list --head "$branch" --state open --json number --jq '.[0].number // empty'; }
pr="$(open_pr)"
if [ -n "$pr" ]; then
  echo "[ship] reusing open PR #$pr for $branch"
else
  echo "[ship] opening PR into main"
  gh pr create --base main --fill
  pr="$(open_pr)"
fi

# 5. Merge (GitHub-side squash) the specific PR, unless --no-merge. Delete the
#    remote branch ONLY after the merge succeeds (never unconditionally).
if [ "$MERGE" -eq 1 ]; then
  [ -n "$pr" ] || { echo "error: no open PR found to merge"; exit 1; }
  echo "[ship] squash-merging PR #$pr into main"
  gh pr merge "$pr" --squash
  git push origin --delete "$branch" 2>/dev/null || true
  cat <<EOF

[ship] merged PR #$pr into main; remote branch deleted.
Remove this worktree when done (run from the MAIN checkout, not here):
    git worktree remove "$PWD" && git branch -D "$branch"
EOF
else
  echo "[ship] PR #${pr:-?} is open; merge it on GitHub when ready (re-run without --no-merge to auto-merge)."
fi
