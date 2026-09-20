import type { ReactNode } from "react";
import Link from "next/link";
import { FloatingIcons } from "./floating-icons";
import { Logo } from "./logo";
import { TONES, type Tone } from "./tone";

/** One frame for every signup/login/verify/reset screen: the wordmark, a clean card, and
 * (player tone only) the drifting sports icons behind it. The content sits at z-10, above
 * the decorative layer at z-0. */
export function AuthShell({
  tone = "player",
  title,
  subtitle,
  children,
  footer,
}: {
  tone?: Tone;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = TONES[tone];
  return (
    <main
      className={`relative min-h-screen flex flex-col items-center px-5 py-10 ${t.fontClass}`}
      style={{ background: t.bg, color: t.ink }}
    >
      {tone === "player" ? <FloatingIcons color={t.accent} /> : null}

      <div className="relative z-10 w-full max-w-[420px] flex flex-col gap-8">
        <Link href="/" className="self-start" aria-label="Maidan home">
          <Logo tone={tone} size={52} />
        </Link>

        <div
          className="flex flex-col gap-7 rounded-3xl p-6 sm:p-8"
          style={{ background: t.surface, border: `1px solid ${t.border}`, boxShadow: "0 1px 2px rgba(20,26,29,0.04), 0 12px 32px rgba(20,26,29,0.06)" }}
        >
          <div className="flex flex-col gap-2">
            <h1 className="text-[27px] font-extrabold tracking-[-0.032em] leading-tight">{title}</h1>
            {subtitle ? (
              <p className="text-[15px] font-medium leading-relaxed" style={{ color: t.muted }}>
                {subtitle}
              </p>
            ) : null}
          </div>
          {children}
        </div>

        {footer ? (
          <div className="text-center text-[14px] font-medium" style={{ color: t.muted }}>
            {footer}
          </div>
        ) : null}
      </div>
    </main>
  );
}
