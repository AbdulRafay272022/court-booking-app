/**
 * Blog post metadata, in one place. Every entry is a "coming soon" card on /blog (no article pages exist yet).
 * To publish a real post later: set `href` (the article route) and `comingSoon: false`; the blog components then render it
 * as a link. Until a post has an `href` it is rendered as a plain, non-clickable card.
 */
export interface BlogPost {
  slug: string;
  /** Small uppercase label on the card. */
  tag: string;
  title: string;
  /** Short summary (shown on the featured card only). */
  summary?: string;
  /** Tailwind background class for the card's colour band (full class name so Tailwind can see it). */
  bandClass: string;
  /** Route of the article once it exists. Leave unset while the post is not written. */
  href?: string;
  comingSoon: boolean;
}

export const FEATURED_POST: BlogPost = {
  slug: "padel-kya-hai",
  tag: "FEATURED",
  title: "Padel kya hai? Beginners ke liye pura guide",
  summary: "Rules, scoring, racket aur pehla match. Sab kuch saada zubaan mein.",
  bandClass: "bg-khelo-orange",
  comingSoon: true,
};

export const BLOG_POSTS: readonly BlogPost[] = [
  { slug: "karachi-futsal-areas", tag: "FUTSAL", title: "Karachi ke best futsal areas: DHA se Gulshan tak", bandClass: "bg-khelo-ink", comingSoon: true },
  { slug: "padel-racket-chunna", tag: "PADEL", title: "Padel racket kaise chunein", bandClass: "bg-khelo-teal", comingSoon: true },
  { slug: "team-slot-booking-tips", tag: "TIPS", title: "Apni team ke liye slot book karne ke 5 asaan tareeqe", bandClass: "bg-khelo-warning", comingSoon: true },
  { slug: "khali-slots-discount", tag: "OWNERS", title: "Khali slots ko kaise bharein: discount ki sahi strategy", bandClass: "bg-khelo-orange", comingSoon: true },
  { slug: "online-payment-proof", tag: "GUIDE", title: "Online payment aur screenshot proof: kaise kaam karta hai", bandClass: "bg-[#6C8CFF]", comingSoon: true },
  { slug: "weekend-match-formula", tag: "COMMUNITY", title: "Weekend match organize karne ka asaan formula", bandClass: "bg-khelo-success", comingSoon: true },
];
