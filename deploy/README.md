# Production deploy (current)

Runs on the AFTR shared web-server EC2 (`i-0fe1dd19adfb072d6`, 13.233.73.99, account 545908811041, ap-south-1)
as three containers in `/opt/court-booking`: `court-booking-db` (postgis/postgis:16-3.4, data in the
`court-booking-pgdata` docker volume), `court-booking-backend`, `court-booking-web`.

- **Deploy**: push to `main` → `.github/workflows/deploy.yml` builds both images → ECR → SSM runs `remote-deploy.sh`.
- **URLs**: web `https://khelo.13.233.73.99.sslip.io`, API `https://api.khelo.13.233.73.99.sslip.io`
  (TLS + routing by the Caddy in the `thesiscraftmentors` container; its Caddyfile lives in Aftr-Solutions/ThesisCraftMentor).
- **Secrets**: SSM Parameter Store `/court-booking-app/...` → `server-env.sh` writes `.env*` on every deploy.
  Add a secret, then re-run the workflow:
  `aws ssm put-parameter --region ap-south-1 --type SecureString --overwrite --name /court-booking-app/secrets/GEMINI_API_KEY --value '...'`
- **Backups**: nightly `db-backup.sh` → `s3://court-booking-app-db-backups-545908811041/` (14 days). Restore / import:
  `sudo /opt/court-booking/db-restore.sh <file|s3://...>`.
- **Shell**: `aws ssm start-session --region ap-south-1 --target i-0fe1dd19adfb072d6`, then
  `cd /opt/court-booking && sudo docker compose ps`.

`infra/` (Terraform with RDS) is the PREVIOUS deployment in the old AWS account and is not used any more.
