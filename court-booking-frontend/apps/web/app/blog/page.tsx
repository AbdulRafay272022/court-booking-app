import type { Metadata } from "next";
import Link from "next/link";
import { KheloPage } from "@/components/site/page-shell";
import { Container, Eyebrow } from "@/components/site/primitives";
import { PostCard } from "@/components/blog/post-card";
import { BLOG_POSTS, FEATURED_POST } from "@/lib/blog-posts";

const DESCRIPTION = "Khelo blog: padel and futsal guides, Karachi areas, and tips for venue owners. Articles are coming soon.";

export const metadata: Metadata = {
  title: "Blog",
  description: DESCRIPTION,
  openGraph: { title: "Blog · Khelo", description: DESCRIPTION, type: "website" },
};

function FeaturedBody() {
  const post = FEATURED_POST;
  return (
    <>
      <div aria-hidden="true" className={`flex min-h-[300px] min-w-0 flex-[1_1_380px] items-center justify-center ${post.bandClass}`}>
        <svg width="200" height="200" viewBox="0 0 200 200" fill="none" aria-hidden="true">
          <rect x="20" y="40" width="160" height="120" rx="12" stroke="#0C1F1D" strokeWidth="6" />
          <path d="M100 40v120" stroke="#0C1F1D" strokeWidth="6" />
          <circle cx="100" cy="100" r="26" stroke="#0C1F1D" strokeWidth="6" />
        </svg>
      </div>
      <div className="min-w-0 flex-[1_1_380px] p-7 md:p-11">
        <span className="rounded-full bg-khelo-mint-2 px-3 py-1.5 text-[12px] font-extrabold tracking-[1px] text-khelo-teal">{post.tag}</span>
        <h2 className="mt-[18px] font-khelo-display text-[30px] font-extrabold leading-[1.1] tracking-[-1.2px] md:text-[38px]">{post.title}</h2>
        <p className="mt-3.5 leading-[1.7] text-khelo-muted">{post.summary}</p>
        {post.comingSoon ? <p className="mt-5 text-[13px] font-bold text-khelo-muted-2">Jald aa raha hai</p> : null}
      </div>
    </>
  );
}

export default function BlogPage() {
  const featuredClass = "flex flex-wrap overflow-hidden rounded-[32px] bg-khelo-surface";
  return (
    <KheloPage>
      {/* HERO */}
      <section className="bg-khelo-ink text-white">
        <Container className="pb-[72px] pt-12 md:pb-[88px]">
          <Eyebrow tone="orange">Khelo Blog</Eyebrow>
          <h1 className="mt-4 max-w-[860px] font-khelo-display text-[40px] font-extrabold leading-none tracking-[-1.4px] md:text-[68px] md:tracking-[-2.2px]">
            Khel, courts aur community ki baatein.
          </h1>
          <p className="mt-6 max-w-[600px] text-[17px] leading-[1.65] text-white/80 md:text-[19px]">
            Padel aur futsal ke guides, Karachi ke areas, aur venue owners ke liye tips.
          </p>
        </Container>
      </section>

      {/* FEATURED */}
      <Container className="pt-[72px]">
        {FEATURED_POST.href ? (
          <Link href={FEATURED_POST.href} className={`khelo-card ${featuredClass}`}>
            <FeaturedBody />
          </Link>
        ) : (
          <article className={featuredClass}>
            <FeaturedBody />
          </article>
        )}
      </Container>

      {/* GRID */}
      <Container className="pb-24 pt-14">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-5">
          {BLOG_POSTS.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
      </Container>
    </KheloPage>
  );
}
