import type { Metadata } from "next";
import Link from "next/link";
import { KheloPage } from "@/components/site/page-shell";
import { Container, Eyebrow } from "@/components/site/primitives";
import { PostCard } from "@/components/blog/post-card";
import { BLOG_POSTS, FEATURED_POST } from "@/lib/blog-posts";
import { getT } from "@/lib/i18n-server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  const description = t("blog.meta.description");
  return { title: t("blog.meta.title"), description, openGraph: { title: t("blog.meta.ogTitle"), description, type: "website" } };
}

async function FeaturedBody() {
  const t = await getT();
  const post = FEATURED_POST;
  return (
    <>
      <div aria-hidden="true" className={`flex min-h-[300px] min-w-0 flex-[1_1_380px] items-center justify-center ${post.bandClass}`}>
        <svg width="200" height="200" viewBox="0 0 200 200" fill="none" aria-hidden="true">
          <rect x="20" y="40" width="160" height="120" rx="12" stroke="var(--color-khelo-ink)" strokeWidth="6" />
          <path d="M100 40v120" stroke="var(--color-khelo-ink)" strokeWidth="6" />
          <circle cx="100" cy="100" r="26" stroke="var(--color-khelo-ink)" strokeWidth="6" />
        </svg>
      </div>
      <div className="min-w-0 flex-[1_1_380px] p-7 md:p-11">
        <span className="rounded-full bg-khelo-mint-2 px-3 py-1.5 text-[12px] font-extrabold tracking-[1px] text-khelo-teal">{t(post.tag)}</span>
        <h2 className="mt-[18px] font-khelo-display text-[30px] font-extrabold leading-[1.1] tracking-[-1.2px] md:text-[38px]">{t(post.title)}</h2>
        <p className="mt-3.5 leading-[1.7] text-khelo-muted">{post.summary ? t(post.summary) : null}</p>
        {post.comingSoon ? <p className="mt-5 text-[13px] font-bold text-khelo-muted-2">{t("blog.comingSoon")}</p> : null}
      </div>
    </>
  );
}

export default async function BlogPage() {
  const t = await getT();
  const featuredClass = "flex flex-wrap overflow-hidden rounded-[32px] bg-khelo-surface";
  return (
    <KheloPage>
      {/* HERO */}
      <section className="bg-khelo-ink text-white">
        <Container className="pb-[72px] pt-12 md:pb-[88px]">
          <Eyebrow tone="orange">{t("blog.hero.eyebrow")}</Eyebrow>
          <h1 className="mt-4 max-w-[860px] font-khelo-display text-[40px] font-extrabold leading-none tracking-[-1.4px] md:text-[68px] md:tracking-[-2.2px]">
            {t("blog.hero.title")}
          </h1>
          <p className="mt-6 max-w-[600px] text-[17px] leading-[1.65] text-white/80 md:text-[19px]">
            {t("blog.hero.sub")}
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
