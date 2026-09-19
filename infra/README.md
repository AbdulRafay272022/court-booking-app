# infra/

Terraform for this project's AWS resources (region `ap-south-1`, Mumbai — closest
region to the Karachi pilot; AWS has none in Pakistan).

| File | What it defines |
|---|---|
| `ecr.tf`, `oidc.tf` | ECR repos + the GitHub Actions OIDC role (Part 0). `oidc.tf` also grants that role `ssm:SendCommand` on the one app instance — that's how deploys reach it. |
| `network.tf` | VPC, 1 public + 2 private subnets, IGW, `ec2-sg` (80/443 only — **no port 22**), `rds-sg` (5432 from `ec2-sg` only). No NAT Gateway, by design. |
| `compute.tf` | The `t3.micro` Ubuntu 24.04 instance, its IAM role (SSM + ECR pull + this project's S3/KMS/SSM params only), the Elastic IP, and the `sslip.io` hostnames. |
| `database.tf` | RDS Postgres 16, `db.t3.micro`, single-AZ, private subnets, not publicly accessible, encrypted, **1-day** automated backups (Free-plan limit; see RUNBOOK.md). |
| `storage.tf` | KMS key, private payment-proofs bucket (KMS, versioned), venue-photos bucket served **only** via CloudFront (Origin Access Control), and the SSM params the instance reads. |
| `scripts/` | `user_data.sh.tftpl` (first boot), `bootstrap.sh` (re-runnable setup phases), `court-booking.cron` (background jobs), `remote-deploy.sh` (what a deploy runs on the box). |

State is local (`terraform.tfstate`, gitignored) — fine for one operator. It contains
the generated RDS password, so **move it to an encrypted S3 backend before a second
person runs `apply`**, and never commit or share it.

## First-time deploy, in order

```bash
cd infra
terraform init
terraform plan -out=tfplan      # review it -- 45 resources on first apply
terraform apply tfplan
terraform output                # instance id, Elastic IP, URLs
```

Then, once, **before the first deploy**:

1. **GitHub → repo → Settings → Actions → Variables**: set `AWS_ROLE_ARN`
   (already set from Part 0), `EC2_INSTANCE_ID` (`terraform output ec2_instance_id`)
   and `API_BASE_URL` (`terraform output api_base_url`).
   `API_BASE_URL` is baked into the web image at build time — set it *before* the
   push that will be deployed, or the web app's browser code will call `localhost`.
2. **Put your secrets in SSM** (values never enter Terraform state). Anything omitted
   is left blank in `.env`; `SESSION_TOKEN_SECRET`, `BANK_DETAILS_ENCRYPTION_KEY` and
   `WHATSAPP_WEBHOOK_VERIFY_TOKEN` are generated for you on the box.
   ```bash
   for k in ANTHROPIC_API_KEY GEMINI_API_KEY WHATSAPP_API_TOKEN WHATSAPP_PHONE_NUMBER_ID WHATSAPP_APP_SECRET; do
     read -rsp "$k: " v; echo
     aws ssm put-parameter --region ap-south-1 --type SecureString --overwrite \
       --name "/court-booking-app/secrets/$k" --value "$v"
   done
   ```
   With an `ANTHROPIC_API_KEY` present the app runs on Claude; with only a
   `GEMINI_API_KEY` it falls back to Gemini (the bootstrap script picks).
3. **Connect** (no SSH — see below) and run the bootstrap phases:
   ```bash
   aws ssm start-session --region ap-south-1 --target "$(terraform output -raw ec2_instance_id)"
   sudo /opt/court-booking-app/bootstrap.sh env       # builds .env / .env.web from SSM
   sudo /opt/court-booking-app/bootstrap.sh db-init   # CREATE EXTENSION postgis on RDS
   ```
4. **Deploy the containers**: push to `main` (or run the workflow manually). The
   workflow builds both images, pushes to ECR, and runs `remote-deploy.sh` on the
   instance via SSM.
5. Back on the box:
   ```bash
   sudo /opt/court-booking-app/bootstrap.sh migrate                 # alembic upgrade head + alembic check
   sudo /opt/court-booking-app/bootstrap.sh nginx-cert <your-email> # nginx + one Let's Encrypt cert for both hostnames
   ```

## Connecting to the instance

There is no SSH: no port 22, no key pair. Use Session Manager (needs the
[Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)):

```bash
aws ssm start-session --region ap-south-1 --target <instance-id>
```

…or the EC2 console's **Connect → Session Manager** tab. Session Manager is
outbound-only from the instance and authenticated by IAM, so nothing is exposed
inbound and there's no IP allow-list to keep accurate on shared Wi-Fi.

## The `sslip.io` hostnames are a deliberate placeholder

No domain is purchased yet. For Elastic IP `52.66.12.34`:

- web: `https://52.66.12.34.sslip.io`
- API: `https://api.52.66.12.34.sslip.io` (this is `apiBaseUrl`)
- WhatsApp webhook: `https://api.52.66.12.34.sslip.io/api/v1/webhooks/whatsapp`
  (note the `/api/v1` prefix — every route except `/health*` is mounted under it)

sslip.io is a public wildcard-DNS service; any `<anything>.<ip>.sslip.io` resolves
to that IP, so Nginx routes by hostname exactly as it will with a real domain.

**Caveats:** sslip.io is a free third-party service (an outage there is a
resolution outage for you), and Let's Encrypt applies issuance rate limits per
registered domain, which sslip.io shares with everyone else using it — if `certbot`
reports a rate limit, that's why, and it's a reason to buy a domain rather than a
bug. The certificate is tied to the Elastic IP: **don't release or replace it**
without redoing the hostnames.

### Migrating off `sslip.io` (small and contained — not a redeploy)

1. Buy a domain; point `A` records for `@` (or `app`) and `api` at the same Elastic IP.
2. On the instance, change the two `server_name` values in
   `/etc/nginx/sites-available/court-booking` (or re-run `bootstrap.sh nginx-cert`
   after updating `WEB_HOST`/`API_HOST` in `/etc/court-booking/host.env`) and re-run
   Certbot for the new hostnames.
3. Update `ALLOWED_ORIGINS` (re-run `bootstrap.sh env`), the GitHub `API_BASE_URL`
   variable (then push, so the web image rebuilds), `apps/mobile/app.json`
   `extra.apiBaseUrl`, and the webhook URL registered with the WhatsApp BSP.

## Background jobs

Run from the instance's cron (`scripts/court-booking.cron`) via
`docker exec court-booking-backend python -m app.jobs.runner <job>`, logging to
`/var/log/court-booking-jobs.log`:

| Job | Schedule (PKT) |
|---|---|
| `expiry` (expiry/no-show/escalation/waitlist cleanup) | every minute |
| `reminders` (2h-ahead booking reminders) | every 10 min |
| `digest` (owner WhatsApp daily digest) | 08:00 |
| `growth` (nightly `slot_stats`) | 02:00 |

**Why not Lambda + EventBridge** (the original plan): a Lambda attached to a VPC
subnet has no internet access without a NAT Gateway (~$35/month, not free tier), and
the expiry job sends WhatsApp notifications. Cron on the instance already has the
network path to RDS, WhatsApp and the AI APIs at $0. Trade-off: the jobs die if the
instance does — but so does the app.

## Changing a secret after the first deploy

Secrets live in SSM under `/court-booking-app/secrets/<NAME>`; the instance's `.env`
is only a rendering of them. To change or add one:

```bash
# 1. put it in SSM (SSM rejects an empty value -- to leave a key blank, just don't create it)
aws ssm put-parameter --region ap-south-1 --type SecureString --overwrite \
  --name /court-booking-app/secrets/GEMINI_API_KEY --value "..."

# 2. on the instance (Session Manager, or SSM Run Command): rebuild .env from SSM
sudo /opt/court-booking-app/bootstrap.sh env

# 3. RECREATE the container -- `docker restart` keeps the old environment, because
#    env_file is only read when a container is created
cd /opt/court-booking-app
export ECR_REGISTRY=<account-id>.dkr.ecr.ap-south-1.amazonaws.com IMAGE_TAG=latest
docker compose -f docker-compose.prod.yml up -d --force-recreate backend
```

- `bootstrap.sh env` rewrites the whole `.env`: a hand edit on the instance is lost.
  The three generated secrets (`SESSION_TOKEN_SECRET`, `BANK_DETAILS_ENCRYPTION_KEY`,
  `WHATSAPP_WEBHOOK_VERIFY_TOKEN`) are created with `--no-overwrite` and survive it.
  Never regenerate `BANK_DETAILS_ENCRYPTION_KEY`: every stored bank detail becomes unreadable.
- **AI provider is derived, not set**: `ANTHROPIC_API_KEY` present → `claude`; else
  `GEMINI_API_KEY` present → `gemini`; else `claude` with a warning and no working AI.
- To confirm what the app actually loaded without printing a secret, check set/empty
  inside the container (`docker exec court-booking-backend sh -c 'test -n "$GEMINI_API_KEY" && echo set'`),
  and list names/dates with `aws ssm describe-parameters` rather than `get-parameter`.

**Running AWS commands from the Windows/Git Bash dev machine:** (a) Git Bash rewrites an
argument starting with `/` into a Windows path, so `--name /court-booking-app/...` fails
validation unless the command is prefixed with `MSYS_NO_PATHCONV=1`; (b) that machine's
default AWS region is `us-east-1`, so always pass `--region ap-south-1` -- a
`put-parameter` without it lands in the wrong region and looks like the secret is missing.

## Current state (verified 2026-09-20)

- Applied and live: instance, RDS, buckets, CloudFront, ECR, OIDC role, Elastic IP
  `3.6.48.6` (see `terraform output`; don't release or replace it, the cert and every
  hostname hang off it). `https://api.3.6.48.6.sslip.io/health` and `/health/ready`
  return 200 with a valid Let's Encrypt certificate.
- Secrets in SSM: the three generated ones plus `GEMINI_API_KEY`, `WHATSAPP_API_TOKEN`,
  `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`. **Not set:** `ANTHROPIC_API_KEY`
  (blank on purpose, so production runs on Gemini), `OPENAI_API_KEY`, and `SENTRY_DSN`
  (so error tracking is off).
- **Still to do, none of it Terraform:** register the webhook with Meta
  (`terraform output whatsapp_webhook_url` + the verify token from SSM); create the
  WhatsApp Authentication message template (needs Meta Business Verification) and add a
  payment method to the WhatsApp Business account. Until then the backend sends OTPs as
  free-form text, which only reaches someone who messaged the business number in the last
  24h -- a temporary code change, revert steps in the backend `CLAUDE.md`; set `SENTRY_DSN`; raise
  `db_backup_retention_days` (1 day is a Free-plan limit) and do the dry-run restore
  described in `court-booking-backend/RUNBOOK.md`; replace the sslip.io hostnames with a
  real domain when one is bought.
- GitHub Actions **variables** the deploy reads: `AWS_ROLE_ARN`, `EC2_INSTANCE_ID`,
  `API_BASE_URL` (see "First-time deploy" above). `gh` isn't installed on the dev machine, so
  their current values weren't checked from there.

## Cost to expect (approximate — check the AWS pricing pages and your account's free-tier status)

EC2 `t3.micro` + RDS `db.t3.micro` + 20 GB storage each, plus the Elastic IP's
public-IPv4 charge, a KMS key (standard SSM parameters, which this uses,
are free). Roughly **$30–35/month** if nothing is free-tier-covered; free-tier
eligibility depends on when the account was created. Note the RDS instance has
`deletion_protection` on and takes a final snapshot on delete — `terraform destroy`
needs `-var deletion_protection=false` applied first, on purpose.
