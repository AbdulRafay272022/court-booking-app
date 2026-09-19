"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";

function OtpForm() {
  const router = useRouter();
  const params = useSearchParams();
  const phone = params.get("phone") ?? "";
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.auth.verifyOtp({ phone, otp: code, platform: "web", device_name: "Web browser" });
      useAuthStore.getState().signIn(res.token, res.user);
      const next = params.get("next");
      if (next) router.replace(next);
      else if (res.user.role === "owner") router.replace("/dashboard/owner/today");
      else if (res.user.role === "admin") router.replace("/dashboard/admin/venues");
      else router.replace("/");
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h1 className="font-extrabold text-2xl tracking-tight text-player-ink">Enter your code</h1>
          <p className="text-player-ink-muted text-[15px]">Six digits, sent to {phone}</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="••••••"
            inputMode="numeric"
            autoFocus
            className="h-14 px-4 rounded-2xl bg-player-surface-2 outline-none text-2xl tracking-[0.3em] text-center font-mono text-player-ink"
          />
          {error ? <p className="text-player-danger text-sm">{error}</p> : null}
          <button
            type="submit"
            disabled={submitting || code.length < 4}
            className="h-13 rounded-2xl bg-player-accent text-white font-bold text-[15px] disabled:opacity-50"
            style={{ height: 52 }}
          >
            {submitting ? "Verifying…" : "Verify"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function OtpPage() {
  return (
    <Suspense>
      <OtpForm />
    </Suspense>
  );
}
