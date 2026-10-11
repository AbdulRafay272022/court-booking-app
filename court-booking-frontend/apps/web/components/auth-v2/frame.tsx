import type { ReactNode } from "react";

/** The court-lines drawing behind the brand panel (decorative). */
function CourtLines() {
  return (
    <svg aria-hidden="true" width="900" height="700" viewBox="0 0 900 700" fill="none" className="pointer-events-none absolute -bottom-[120px] -right-[300px] opacity-10">
      <rect x="40" y="60" width="800" height="560" rx="24" stroke="#fff" strokeWidth="3" />
      <line x1="440" y1="60" x2="440" y2="620" stroke="#fff" strokeWidth="3" />
      <circle cx="440" cy="340" r="100" stroke="#fff" strokeWidth="3" />
    </svg>
  );
}

/**
 * Split screen for Login and Signup: a brand panel (ink, or teal for the owner role) that disappears below 860px, and the
 * form panel. `brandWidth` is the panel's share (50 on Login, 42 on Signup).
 */
export function AuthFrame({
  brandBg = "ink",
  brandWidth = 50,
  brandTitle,
  brandTitleSize = "login",
  brandText,
  brandExtra,
  children,
}: {
  brandBg?: "ink" | "teal";
  brandWidth?: 50 | 42;
  brandTitle: ReactNode;
  brandTitleSize?: "login" | "signup";
  brandText: string;
  brandExtra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-[max(760px,calc(100vh-81px))] flex-nowrap">
      <div
        className={`relative hidden min-w-0 flex-col justify-between overflow-hidden px-14 py-12 text-white min-[861px]:flex ${brandBg === "teal" ? "bg-khelo-teal" : "bg-khelo-ink"}`}
        style={{ flex: `1 1 ${brandWidth}%` }}
      >
        <CourtLines />
        <div />
        <div className="relative">
          <p
            className={`m-0 font-khelo-display font-extrabold ${
              brandTitleSize === "login" ? "text-[64px] leading-[0.98] tracking-[-2px]" : "text-[54px] leading-none tracking-[-1.8px]"
            }`}
          >
            {brandTitle}
          </p>
          <p className={`mt-5 max-w-[440px] text-[18px] leading-[1.6] ${brandBg === "teal" ? "text-white/80" : "text-white/75"}`}>{brandText}</p>
          {brandExtra}
        </div>
        <div className="relative text-[13px] text-white/55">&copy; 2026 Khelo, a Logic Link System product</div>
      </div>
      <div className="flex min-w-0 items-center justify-center bg-khelo-page px-6 py-10" style={{ flex: `1 1 ${100 - brandWidth}%` }}>
        {children}
      </div>
    </div>
  );
}
