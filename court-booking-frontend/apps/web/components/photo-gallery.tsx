"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A real photo gallery: the selected photo fills a fixed aspect-ratio frame (object-cover, so photos of any shape
 * never leave empty space or resize the page), prev/next arrows and a counter, and a thumbnail strip underneath that
 * scrolls sideways (with a visible scrollbar on desktop and snap on touch) and keeps the selected thumbnail in view.
 * Works with zero photos (gradient placeholder), one photo (no controls) and many.
 */
export function PhotoGallery({
  photos,
  alt,
  fallback = "linear-gradient(135deg,#12657A,#0A3E4A)",
  aspectClass = "aspect-[4/3] md:aspect-[16/9]",
  thumbSize = 72,
  className = "",
  testId = "photo-gallery",
}: {
  photos: string[];
  alt: string;
  fallback?: string;
  /** Tailwind aspect-ratio classes for the frame. */
  aspectClass?: string;
  thumbSize?: number;
  className?: string;
  testId?: string;
}) {
  const [index, setIndex] = useState(0);
  const stripRef = useRef<HTMLDivElement>(null);
  const count = photos.length;
  const current = Math.min(index, Math.max(0, count - 1));

  // keep the selected thumbnail visible inside the strip (scrolls only the strip, never the page)
  useEffect(() => {
    const strip = stripRef.current;
    const thumb = strip?.children[current] as HTMLElement | undefined;
    if (!strip || !thumb) return;
    const left = thumb.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft || left + thumb.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: left - (strip.clientWidth - thumb.offsetWidth) / 2, behavior: "smooth" });
    }
  }, [current]);

  const go = (delta: number) => setIndex((i) => (Math.min(i, count - 1) + delta + count) % count);

  return (
    <div
      className={`flex flex-col gap-2.5 min-w-0 ${className}`}
      data-testid={testId}
      tabIndex={count > 1 ? 0 : undefined}
      onKeyDown={(e) => {
        if (count < 2) return;
        if (e.key === "ArrowLeft") go(-1);
        if (e.key === "ArrowRight") go(1);
      }}
    >
      <div className={`relative w-full overflow-hidden rounded-2xl bg-player-surface-2 ${aspectClass}`}>
        {count === 0 ? (
          <div className="absolute inset-0" style={{ background: fallback }} role="img" aria-label={alt} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={photos[current]} src={photos[current]} alt={`${alt} photo ${current + 1} of ${count}`} className="absolute inset-0 w-full h-full object-cover" data-testid="gallery-main" />
        )}
        {count > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={() => go(-1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/55 text-white text-lg leading-none flex items-center justify-center hover:bg-black/70"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => go(1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/55 text-white text-lg leading-none flex items-center justify-center hover:bg-black/70"
            >
              ›
            </button>
            <span className="absolute right-2.5 bottom-2.5 px-2 py-0.5 rounded-full bg-black/55 text-white text-[12px] font-semibold font-mono">
              {current + 1} / {count}
            </span>
          </>
        ) : null}
      </div>

      {count > 1 ? (
        <div
          ref={stripRef}
          className="flex gap-2 overflow-x-auto pb-1.5 snap-x"
          style={{ scrollbarWidth: "thin" }}
          role="listbox"
          aria-label="Photo thumbnails"
        >
          {photos.map((url, i) => (
            <button
              key={`${url}-${i}`}
              type="button"
              role="option"
              aria-selected={i === current}
              aria-label={`Show photo ${i + 1}`}
              onClick={() => setIndex(i)}
              className={`shrink-0 snap-start rounded-lg overflow-hidden border-2 ${i === current ? "border-player-accent" : "border-transparent opacity-75 hover:opacity-100"}`}
              style={{ width: thumbSize, height: Math.round(thumbSize * 0.75) }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
