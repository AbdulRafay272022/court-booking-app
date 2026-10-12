import type { MessageKey } from "@/lib/i18n";

/**
 * Blog post metadata, in one place. Every entry is a "coming soon" card on /blog (no article pages exist yet).
 * To publish a real post later: set `href` (the article route) and `comingSoon: false`; the blog components then render it
 * as a link. Until a post has an `href` it is rendered as a plain, non-clickable card.
 */
export interface BlogPost {
  slug: string;
  /** Small uppercase label on the card (dictionary key; the copy lives in the blog message files). */
  tag: MessageKey;
  title: MessageKey;
  /** Short summary (shown on the featured card only). */
  summary?: MessageKey;
  /** Tailwind background class for the card's colour band (full class name so Tailwind can see it). */
  bandClass: string;
  /** Route of the article once it exists. Leave unset while the post is not written. */
  href?: string;
  comingSoon: boolean;
}

export const FEATURED_POST: BlogPost = {
  slug: "padel-kya-hai",
  tag: "blog.tag.featured",
  title: "blog.post.padel-kya-hai.title",
  summary: "blog.post.padel-kya-hai.summary",
  bandClass: "bg-khelo-orange",
  comingSoon: true,
};

export const BLOG_POSTS: readonly BlogPost[] = [
  { slug: "karachi-futsal-areas", tag: "blog.tag.futsal", title: "blog.post.karachi-futsal-areas.title", bandClass: "bg-khelo-ink", comingSoon: true },
  { slug: "padel-racket-chunna", tag: "blog.tag.padel", title: "blog.post.padel-racket-chunna.title", bandClass: "bg-khelo-teal", comingSoon: true },
  { slug: "team-slot-booking-tips", tag: "blog.tag.tips", title: "blog.post.team-slot-booking-tips.title", bandClass: "bg-khelo-warning", comingSoon: true },
  { slug: "khali-slots-discount", tag: "blog.tag.owners", title: "blog.post.khali-slots-discount.title", bandClass: "bg-khelo-orange", comingSoon: true },
  { slug: "online-payment-proof", tag: "blog.tag.guide", title: "blog.post.online-payment-proof.title", bandClass: "bg-khelo-blog-blue", comingSoon: true },
  { slug: "weekend-match-formula", tag: "blog.tag.community", title: "blog.post.weekend-match-formula.title", bandClass: "bg-khelo-success", comingSoon: true },
];
