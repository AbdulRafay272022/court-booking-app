"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 9) {
      setError("Enter a valid mobile number.");
      return;
    }
    const fullPhone = `+92${digits.replace(/^0/, "")}`;
    setSubmitting(true);
    try {
      await api.auth.requestOtp({ phone: fullPhone });
      const qs = new URLSearchParams({ phone: fullPhone });
      if (next) qs.set("next", next);
      router.push(`/otp?${qs.toString()}`);
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
          <h1 className="font-extrabold text-3xl tracking-tight text-player-ink">Maidan</h1>
          <p className="text-player-ink-muted text-[15px]">Find a court near you and book it in a minute.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold tracking-wider text-player-ink-fainter">MOBILE NUMBER</label>
            <div className="flex items-center gap-2 px-4 rounded-2xl bg-player-surface-2" style={{ height: 52 }}>
              <span className="text-player-ink-muted text-sm font-medium">PK +92</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="300 4408817"
                inputMode="numeric"
                className="flex-1 bg-transparent outline-none text-[15px] text-player-ink placeholder:text-player-ink-fainter"
              />
            </div>
            <p className="text-xs text-player-ink-faint">We&apos;ll send your code on WhatsApp</p>
          </div>

          {error ? <p className="text-player-danger text-sm">{error}</p> : null}

          <button
            type="submit"
            disabled={submitting}
            className="rounded-2xl bg-player-accent text-white font-bold text-[15px] disabled:opacity-50"
            style={{ height: 52 }}
          >
            {submitting ? "Sending…" : "Continue"}
          </button>
        </form>

        <p className="text-xs text-player-ink-fainter text-center">By continuing you agree to our Terms and Privacy Policy.</p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
