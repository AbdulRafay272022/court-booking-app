/**
 * https://<site>/app -> the latest owner APK (founder 14 Nov; owners install the APK directly, no Play Store). The mobile
 * "Update karein" screen opens this page, so the link inside the app never changes; only this redirect target does.
 *
 * Target: APK_URL from the running container's environment (.env.web, read at request time, so changing it needs only a web
 * restart), else the fixed S3 file that infra/scripts/publish-apk.sh replaces on every release. Only an https link is used.
 */
export const DEFAULT_APK_URL =
  "https://court-booking-app-app-downloads-959666773387.s3.ap-south-1.amazonaws.com/app/khelo-latest.apk";

export function resolveApkUrl(env: Record<string, string | undefined>): string {
  const v = env["APK_URL"]?.trim();
  return v && /^https:\/\/\S+$/i.test(v) ? v : DEFAULT_APK_URL;
}
