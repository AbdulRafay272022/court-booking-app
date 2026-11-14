# Owner app downloads (APK)

Owners install the Android app from an APK (no Play Store; no iPhone yet). One fixed link always gives the latest APK:

- **`https://3.6.48.6.sslip.io/app`**: the link inside the app ("Update karein") and the one to share. It redirects to:
- **`https://court-booking-app-app-downloads-959666773387.s3.ap-south-1.amazonaws.com/app/khelo-latest.apk`**: the file
  itself, replaced on every release.

The web's `/app` (`apps/web/app/app/route.ts`) redirects to `APK_URL` from `.env.web` if set (https only), else to the S3
file above. Changing `APK_URL` needs only a web restart, no rebuild. When the site moves off sslip.io, also update
`EXPO_PUBLIC_UPDATE_URL` (apps/mobile/eas.json and `scripts/ota-preview.sh`) and `KHELO_WEB_URL` below.

## The bucket (infra/downloads.tf)

A **separate** bucket: the payment-proof bucket (private, KMS) and the venue-photo bucket (private, CloudFront only) are not
touched. Here only `app/*` is publicly readable (GetObject); nothing can be listed, ACLs are off, versioning keeps old copies.
Created by `terraform apply` (after reading `terraform plan`: it must only ADD the downloads resources).

## On every new APK

1. Build it: `npx eas-cli@27.9.0 build --profile preview --platform android` (the profile the owners' APKs use; channel
   `preview`). Note the APK link EAS prints (EAS links expire after about 14 days, so do the next step the same day).
2. Publish it (Git Bash, AWS CLI logged in to the project account):

   ```bash
   infra/scripts/publish-apk.sh "<EAS .apk link or local path>" "<git sha of the build>"
   ```

   It uploads `app/khelo-YYYY-MM-DD-<sha>.apk` (dated copy, kept) and then replaces `app/khelo-latest.apk`, and checks that
   the latest link serves the new file and that `/app` redirects.
3. Open `https://3.6.48.6.sslip.io/app` on a phone: it must download the new APK.

**Going back to an older APK:** copy its dated file over the latest one, e.g.
`aws s3 cp s3://<bucket>/app/khelo-2026-11-20-abc1234.apk s3://<bucket>/app/khelo-latest.apk --region ap-south-1 --content-type application/vnd.android.package-archive --cache-control no-cache`,
or set `APK_URL` in `.env.web` to the dated link and restart the web.

## JS-only changes (no new APK)

`apps/mobile/scripts/ota-preview.sh "message"` publishes an OTA update to channel `preview` (the owners' APKs). It refuses to
run against a non-production API or before the production backend is the new one. See docs/design/LEDGER-V2-ROLLOUT.md.
