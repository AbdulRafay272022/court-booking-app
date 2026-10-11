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
          <svg width="170" height="170" viewBox="0 0 34 34" fill="none">
            <rect width="34" height="34" rx="10" fill="#FF6A2B" />
            <rect x="7" y="9" width="20" height="16" rx="2" stroke="#0C1F1D" strokeWidth="2.2" />
            <path d="M17 9v16M7 17h20" stroke="#0C1F1D" strokeWidth="2.2" />
          </svg>
          <div style={{ fontSize: 150, fontWeight: 800, letterSpacing: -4, lineHeight: 1 }}>Khelo</div>
        </div>
        <div style={{ marginTop: 48, fontSize: 48, color: "#DDF3EF" }}>Court dhoondo. Slot lo. Khelo.</div>
      </div>
    ),
    { ...size },
  );
}
