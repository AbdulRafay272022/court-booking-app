import { NextResponse } from "next/server";
import { resolveApkUrl } from "@/lib/apk-url";

// read APK_URL per request (never baked in at build time), and never cache the redirect: a new APK must show at once
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.redirect(resolveApkUrl(process.env), { status: 302, headers: { "Cache-Control": "no-store" } });
}
