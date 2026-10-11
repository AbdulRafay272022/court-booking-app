import Link from "next/link";
import type { BlogPost } from "@/lib/blog-posts";

/** A grid card. A post without `href` is a plain article (not a link) and shows "Jald aa raha hai". */
export function PostCard({ post }: { post: BlogPost }) {
  const body = (
    <>
      <div aria-hidden="true" className={`h-[140px] ${post.bandClass}`} />
      <div className="flex flex-1 flex-col gap-2.5 p-[26px]">
        <span className="self-start rounded-full bg-khelo-page px-2.5 py-[5px] text-[11px] font-extrabold tracking-[1px] text-khelo-teal">{post.tag}</span>
        <h3 className="text-[21px] font-extrabold leading-[1.25]">{post.title}</h3>
        {post.comingSoon ? <p className="mt-auto text-[13px] font-bold text-khelo-muted-2">Jald aa raha hai</p> : null}
      </div>
    </>
  );
  const base = "flex flex-col overflow-hidden rounded-[28px] bg-khelo-surface";
  if (post.href) {
    return (
      <Link href={post.href} className={`khelo-card ${base}`}>
        {body}
      </Link>
    );
  }
  return <article className={base}>{body}</article>;
}
