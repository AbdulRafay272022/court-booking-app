"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type TouchEvent } from "react";
import { useT } from "@/components/i18n/lang-provider";
import { ModalShell } from "@/components/owner/modal-shell";
import { ChevronLeft, ChevronRight, X, cx } from "@/components/fl";
import { counterText, stepIndex, swipeDelta } from "@/lib/gallery-nav";

type Point = { x: number; y: number };
const pointOf = (e: TouchEvent, which: "touches" | "changedTouches"): Point | null => {
  const t = e[which][0];
  return t ? { x: t.clientX, y: t.clientY } : null;
};

/** 44px round arrow on a photo (white glass, ink icon: readable on any photo). */
const ARROW =
  "absolute top-1/2 z-[2] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-fl-a-arrow-on-photo text-fl-night shadow-fl-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fl-white";

/**
 * Venue / court photo gallery (Venue.dc.html hero). It never moves by itself (no autoplay on the detail page): swipe, the 44px
 * arrows, arrow keys or a thumbnail change the photo, a "1/6" counter shows where you are, and a click on the photo opens a
 * full-screen gallery (Esc / Close / backdrop close it). The frame has a fixed aspect ratio (object-cover), so photos of any shape
 * never resize the page. Zero photos = court-line placeholder (no fake photo), one photo = no controls.
 */
export function PhotoGallery({
  photos,
  alt,
  fallbackClass = "bg-fl-teal",
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
  const t = useT();
  const [index, setIndex] = useState(0);
  const [full, setFull] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const touch = useRef<Point | null>(null);
  const swiped = useRef(false);
  const count = photos.length;
  const current = stepIndex(index, 0, count);
  const counter = counterText(current, count);

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

  const go = (delta: number) => setIndex((i) => stepIndex(i, delta, count));
  const onKeyDown = (e: KeyboardEvent) => {
    if (count < 2) return;
    if (e.key === "ArrowLeft") go(-1);
    if (e.key === "ArrowRight") go(1);
  };
  const swipeHandlers = {
    onTouchStart: (e: TouchEvent) => {
      touch.current = pointOf(e, "touches");
      swiped.current = false;
    },
    onTouchEnd: (e: TouchEvent) => {
      const d = swipeDelta(touch.current, pointOf(e, "changedTouches"));
      touch.current = null;
      if (d !== 0 && count > 1) {
        swiped.current = true;
        go(d);
      }
    },
  };

  return (
    <div className={`flex min-w-0 flex-col gap-2.5 ${className}`} data-testid={testId} onKeyDown={onKeyDown}>
      <div className={`relative w-full overflow-hidden rounded-fl-card bg-fl-night ${aspectClass}`} {...swipeHandlers}>
        {count === 0 ? (
          <div className={`absolute inset-0 ${fallbackClass}`} role="img" aria-label={alt}>
            <svg aria-hidden="true" width="100%" height="100%" viewBox="0 0 280 170" fill="none" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 stroke-fl-a-court-lines">
              <rect x="30" y="25" width="220" height="120" rx="10" strokeWidth="3" />
              <line x1="140" y1="25" x2="140" y2="145" strokeWidth="3" />
              <circle cx="140" cy="85" r="22" strokeWidth="3" />
            </svg>
          </div>
        ) : (
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-zoom-in focus-visible:outline-3 focus-visible:-outline-offset-4 focus-visible:outline-fl-white"
            aria-label={t("venue.gallery.open", { alt, n: current + 1 })}
            data-testid="gallery-open"
            onClick={() => {
              if (swiped.current) {
                swiped.current = false;
                return;
              }
              setFull(true);
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- remote S3/CloudFront URLs; no thumbnails exist (contract B4) */}
            <img key={photos[current]} src={photos[current]} alt={t("venue.gallery.photoOf", { alt, n: current + 1, count })} className="absolute inset-0 h-full w-full object-cover" data-testid="gallery-main" draggable={false} />
          </button>
        )}
        {count > 1 ? (
          <>
            <button type="button" aria-label={t("venue.gallery.prev")} onClick={() => go(-1)} className={`${ARROW} left-2.5`}>
              <ChevronLeft size={18} strokeWidth={2.4} />
            </button>
            <button type="button" aria-label={t("venue.gallery.next")} onClick={() => go(1)} className={`${ARROW} right-2.5`}>
              <ChevronRight size={18} strokeWidth={2.4} />
            </button>
            <span data-testid="gallery-counter" className="pointer-events-none absolute bottom-2.5 right-2.5 z-[2] rounded-full bg-fl-a-on-photo px-2.5 py-1 text-[12px] font-extrabold tabular-nums text-fl-white">
              {counter}
            </span>
          </>
        ) : null}
      </div>

      {count > 1 ? (
        <div ref={stripRef} className="flex snap-x gap-2 overflow-x-auto pb-1.5" style={{ scrollbarWidth: "thin" }} role="listbox" aria-label={t("venue.gallery.thumbs")}>
          {photos.map((url, i) => (
            <button
              key={`${url}-${i}`}
              type="button"
              role="option"
              aria-selected={i === current}
              aria-label={t("venue.gallery.show", { n: i + 1 })}
              onClick={() => setIndex(i)}
              className={`shrink-0 snap-start overflow-hidden rounded-fl-sm border-2 ${i === current ? "border-fl-orange" : "border-transparent opacity-75 hover:opacity-100"}`}
              style={{ width: Math.max(44, thumbSize), height: Math.max(44, Math.round(thumbSize * 0.75)) }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      ) : null}

      {full && count > 0 ? (
        <ModalShell label={t("venue.gallery.full", { alt })} onClose={() => setFull(false)} fullscreen>
          <div className="flex h-full flex-col" data-testid="gallery-full">
            <div className="flex items-center justify-between gap-3 p-3">
              <span className="rounded-full bg-fl-a-on-photo px-3 py-1.5 text-[13px] font-extrabold tabular-nums text-fl-white" aria-live="polite">
                {counter ?? ""}
              </span>
              <button
                type="button"
                onClick={() => setFull(false)}
                data-testid="gallery-close"
                className="flex h-11 items-center gap-1.5 rounded-full bg-fl-white px-4 text-[14px] font-extrabold text-fl-night focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fl-orange"
              >
                <X size={16} strokeWidth={2.4} />
                {t("media.lb.close")}
              </button>
            </div>
            <div className="relative min-h-0 flex-1 select-none" {...swipeHandlers}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={photos[current]}
                src={photos[current]}
                alt={t("venue.gallery.photoOf", { alt, n: current + 1, count })}
                className="absolute inset-0 m-auto max-h-full max-w-full object-contain"
                data-testid="gallery-full-img"
                draggable={false}
              />
              {count > 1 ? (
                <>
                  <button type="button" aria-label={t("venue.gallery.prev")} onClick={() => go(-1)} className={cx(ARROW, "left-3")}>
                    <ChevronLeft size={20} strokeWidth={2.4} />
                  </button>
                  <button type="button" aria-label={t("venue.gallery.next")} onClick={() => go(1)} className={cx(ARROW, "right-3")}>
                    <ChevronRight size={20} strokeWidth={2.4} />
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </ModalShell>
      ) : null}
    </div>
  );
}
