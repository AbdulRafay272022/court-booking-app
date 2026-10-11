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
  fallbackClass = "bg-khelo-teal",
  aspectClass = "aspect-[4/3] md:aspect-[16/9]",
  thumbSize = 72,
  className = "",
  testId = "photo-gallery",
}: {
  photos: string[];
  alt: string;
  fallbackClass?: string;
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
      <div className={`relative w-full overflow-hidden rounded-3xl bg-khelo-ink ${aspectClass}`}>
        {count === 0 ? (
          <div className={`absolute inset-0 ${fallbackClass}`} role="img" aria-label={alt}>
            <svg aria-hidden="true" width="100%" height="100%" viewBox="0 0 280 170" fill="none" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 opacity-25">
              <rect x="30" y="25" width="220" height="120" rx="10" stroke="white" strokeWidth="3" />
              <line x1="140" y1="25" x2="140" y2="145" stroke="white" strokeWidth="3" />
              <circle cx="140" cy="85" r="22" stroke="white" strokeWidth="3" />
            </svg>
          </div>
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
              className="absolute left-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-khelo-ink/80 text-white text-xl leading-none flex items-center justify-center hover:bg-khelo-ink"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => go(1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-khelo-ink/80 text-white text-xl leading-none flex items-center justify-center hover:bg-khelo-ink"
            >
              ›
            </button>
            <span className="absolute right-2.5 bottom-2.5 px-2.5 py-1 rounded-full bg-khelo-ink/80 text-white text-[12px] font-bold">
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
              className={`shrink-0 snap-start rounded-xl overflow-hidden border-2 ${i === current ? "border-khelo-orange" : "border-transparent opacity-75 hover:opacity-100"}`}
              style={{ width: Math.max(44, thumbSize), height: Math.max(44, Math.round(thumbSize * 0.75)) }}
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
