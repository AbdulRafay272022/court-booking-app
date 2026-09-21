#!/bin/bash
# Promote ONE existing, phone-verified PLAYER account to admin on the production instance.
#
#   bash infra/scripts/promote_admin.sh +923XXXXXXXXX
#
# Runs infra/scripts/promote_admin.py inside the backend container over SSM (no SSH). The script
# aborts, changing nothing, unless exactly one account matches, it is a `player`, and its phone is
# verified; on success it writes an audit_log row. There is no other way to create an admin: signup
# cannot (`admin` is not a selectable role) and there is no admin-management endpoint.
#
# Needs AWS credentials for account 959666773387. INSTANCE_ID defaults to `terraform output` from
# ./infra; override it if terraform state isn't available. Region is pinned to ap-south-1 on purpose:
# this machine's AWS CLI default is us-east-1.
set -euo pipefail
export MSYS_NO_PATHCONV=1  # Git Bash otherwise rewrites arguments that start with "/"

PHONE="${1:?usage: promote_admin.sh +923XXXXXXXXX}"
DIR="$(cd "$(dirname "$0")" && (pwd -W 2>/dev/null || pwd))"  # pwd -W: Windows path, the aws CLI can't read /tmp/...
INSTANCE_ID="${INSTANCE_ID:-$(cd "$DIR/.." && terraform output -raw ec2_instance_id)}"

B64="$(base64 -w0 "$DIR/promote_admin.py")"
PARAMS="$DIR/.promote_params.json"
printf '{"commands":["echo %s | base64 -d | docker exec -i court-booking-backend python - %s"]}' "$B64" "$PHONE" > "$PARAMS"
trap 'rm -f "$PARAMS"' EXIT

CID="$(aws ssm send-command --region ap-south-1 --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript --parameters "file://$PARAMS" \
  --query Command.CommandId --output text)"
sleep 8
aws ssm get-command-invocation --region ap-south-1 --command-id "$CID" --instance-id "$INSTANCE_ID" \
  --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
