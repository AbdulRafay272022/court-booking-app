import { Noto_Naskh_Arabic } from "next/font/google";

/**
 * Urdu-script font for the footer brand (کھیلو). Noto Naskh Arabic was chosen over Noto Nastaliq Urdu: at 24-28px Nastaliq's
 * kaaf tail rises above the line box and collides with neighbours unless the line-height is huge; Naskh renders cleanly at 1.5.
 * Only the Arabic subset is loaded (a few glyphs), and it is only applied to one span.
 */
export const urduFont = Noto_Naskh_Arabic({ subsets: ["arabic"], weight: ["600", "700"], display: "swap" });
