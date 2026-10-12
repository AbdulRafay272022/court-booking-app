import type { ReactNode } from "react";

/** A white rounded card, the surface every account section sits on. */
export function Card({ children, className = "", as: Tag = "div", ...rest }: { children: ReactNode; className?: string; as?: "div" | "section" } & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={`rounded-3xl bg-khelo-surface p-5 shadow-[0_1px_2px_rgba(12,31,29,0.06)] sm:p-6 ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

/** Round avatar: the photo, or the first letter of the name on a tinted circle. */
export function Avatar({ url, name, size, alt }: { url: string | null; name: string; size: number; alt: string }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={alt} width={size} height={size} style={{ width: size, height: size }} className="shrink-0 rounded-full border border-khelo-divider object-cover" />;
  }
  return (
    <div
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      className="flex shrink-0 items-center justify-center rounded-full bg-khelo-mint font-khelo-display font-extrabold text-khelo-teal"
    >
      {initial}
    </div>
  );
}
