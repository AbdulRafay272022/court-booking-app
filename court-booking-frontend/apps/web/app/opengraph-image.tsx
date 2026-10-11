import { ImageResponse } from "next/og";

export const alt = "Khelo: Court dhoondo. Slot lo. Khelo.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0C1F1D",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "#FFFFFF",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          <svg width="170" height="170" viewBox="0 0 512 512">
            <defs>
              <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#F2703D" />
                <stop offset="1" stopColor="#E44E1F" />
              </linearGradient>
            </defs>
            <rect width="512" height="512" rx="120" fill="url(#bg)" />
            <g fill="none" stroke="#FFFFFF" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round">
              <rect x="92" y="136" width="328" height="240" rx="20" />
              <line x1="256" y1="136" x2="256" y2="376" />
              <circle cx="256" cy="256" r="46" />
            </g>
            <circle cx="256" cy="256" r="9" fill="#FFFFFF" />
          </svg>
          <div style={{ fontSize: 150, fontWeight: 800, letterSpacing: -4, lineHeight: 1 }}>Khelo</div>
        </div>
        <div style={{ marginTop: 48, fontSize: 48, color: "#DDF3EF" }}>Court dhoondo. Slot lo. Khelo.</div>
      </div>
    ),
    { ...size },
  );
}
