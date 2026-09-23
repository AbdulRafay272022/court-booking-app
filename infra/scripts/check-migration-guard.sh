#!/usr/bin/env bash
# Migration guard, run by .github/workflows/deploy.yml before anything is deployed.
#
# WHY: every push to main deploys, and the deploy script (infra/scripts/remote-deploy.sh) runs `alembic upgrade head`
# on PRODUCTION from the new image before the new backend starts. So a push that contains a migration IS the migration.
# The project owner requires that no migration reaches production without their explicit "go" (and a fresh manual RDS
# snapshot). This script makes that impossible to do by accident:
#
#   - no migration file added/changed in the push  -> passes silently
#   - a migration file added/changed               -> prints a loud warning, and FAILS the run (nothing is deployed)
#                                                     unless a commit in the push has a line that is EXACTLY
#                                                         Migration-Go: owner-approved
#                                                     in its message (the whole line, nothing else on it), which is
#                                                     added only after the owner says "go". A commit message that merely
#                                                     MENTIONS the words does not count.
#
# usage: check-migration-guard.sh <commit before the push> <commit after the push>
set -euo pipefail

BEFORE="${1:-}"
AFTER="${2:-HEAD}"
MIGRATIONS_DIR="court-booking-backend/alembic/versions"

if [ -z "$BEFORE" ] || [[ "$BEFORE" =~ ^0+$ ]]; then
  echo "migration guard: no base commit (manual run or first push) -- skipping. A manual run deploys whatever is on main."
  exit 0
fi
if ! git cat-file -e "${BEFORE}^{commit}" 2>/dev/null; then
  echo "::error::migration guard: cannot see the previous commit ${BEFORE} (force push?). Refusing to guess: re-run after checking that no migration is included."
  exit 1
fi

changed="$(git diff --name-only --diff-filter=ACMR "$BEFORE" "$AFTER" -- "$MIGRATIONS_DIR" | grep '\.py$' || true)"
if [ -z "$changed" ]; then
  echo "migration guard: no migration in this push. OK."
  exit 0
fi

echo "::warning::THIS PUSH CONTAINS A DATABASE MIGRATION. The deploy runs it on PRODUCTION automatically."
echo "Migration file(s) in this push:"
echo "$changed" | sed 's/^/  - /'

COMMIT_MSGS="$(git log --format=%B "${BEFORE}..${AFTER}" | tr -d '\r')"
if grep -qx "Migration-Go: owner-approved" <<< "$COMMIT_MSGS"; then
  echo "migration guard: a commit in this push carries the line 'Migration-Go: owner-approved' (the owner approved it). Continuing."
  exit 0
fi

cat <<'MSG'
::error::MIGRATION BLOCKED. A migration must never reach production without the project owner's explicit "go" (and a fresh manual RDS snapshot). Nothing was deployed.
To proceed, the owner says "go"; then add a line reading exactly 'Migration-Go: owner-approved' to a commit message in the push (docs/SECTION_32_PLAN.md, "Migration rules"). Otherwise, remove the migration from this push.
MSG
exit 1
