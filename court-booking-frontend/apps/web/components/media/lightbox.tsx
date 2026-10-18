"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useT } from "@/components/i18n/lang-provider";
import { ModalShell } from "@/components/owner/modal-shell";
import { STEP, clampPan, fitView, isFit, isMax, zoomAt, zoomPercent, type Size, type View } from "./zoom";

export interface LightboxProps {
  src: string;
  alt: string;
  onClose: () => void;
  /** Called once when the image fails to load (a signed URL that expired); the parent passes a fresh `src`. */
  onExpired?: () => void;
}

/**
 * Full-screen screenshot viewer (Round 2, A3): opens fitted to the screen; "-", "+", "Fit", mouse wheel, pinch (pointer events) and
 * keyboard (+ - 0, arrows) zoom between fit and 4x; drag to pan once zoomed. Esc, Close or a click outside the image closes it.
 * Focus trap, body scroll lock and focus return come from ModalShell.
 */
export function Lightbox({ src, alt, onClose, onExpired }: LightboxProps) {
  const t = useT();
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Size>({ w: 0, h: 0 });
  const [natural, setNatural] = useState<{ src: string; size: Size } | null>(null);
  // null = fitted (stays fitted when the window is resized)
  const [view, setView] = useState<View | null>(null);
  const [retried, setRetried] = useState(false);
  const [failed, setFailed] = useState(false);

  const image = natural && natural.src === src ? natural.size : null;
  const effective: View | null = image ? clampPan(view ?? fitView(stage, image), stage, image) : null;
  const atFit = !image || !effective || isFit(effective, stage, image);
  const atMax = !!image && !!effective && isMax(effective, stage, image);

  // Event handlers read the newest numbers from here.
  const latest = useRef({ stage, image, view: effective });
  useEffect(() => {
    latest.current = { stage, image, view: effective };
  });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function apply(next: View) {
    const { stage: s, image: img } = latest.current;
    if (!img) return;
    setView(isFit(next, s, img) ? null : next);
  }

  function zoomBy(factor: number, focus = { x: 0, y: 0 }) {
    const { stage: s, image: img, view: v } = latest.current;
    if (!img || !v) return;
    apply(zoomAt(v, v.scale * factor, focus, s, img));
  }

  // Wheel zoom needs a non-passive listener to stop the page from scrolling / zooming.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const focus = { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
      const { stage: s, image: img, view: v } = latest.current;
      if (!img || !v) return;
      const next = zoomAt(v, v.scale * Math.exp(-e.deltaY * 0.0015), focus, s, img);
      setView(isFit(next, s, img) ? null : next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // --- pointer: one finger / mouse pans, two fingers pinch ---
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: View; dist: number; mid: { x: number; y: number }; start: { x: number; y: number }; moved: boolean; onBackground: boolean } | null>(null);

  function rel(p: { x: number; y: number }) {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: p.x - r.left - r.width / 2, y: p.y - r.top - r.height / 2 };
  }

  function beginGesture(onBackground: boolean) {
    const v = latest.current.view;
    if (!v) return;
    const pts = [...pointers.current.values()];
    const mid = pts.length >= 2 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
    const dist = pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    gesture.current = { view: v, dist, mid, start: pts[0], moved: gesture.current?.moved ?? false, onBackground };
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 1) gesture.current = null;
    beginGesture(gesture.current?.onBackground ?? e.target === e.currentTarget);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const { stage: s, image: img } = latest.current;
    if (!g || !img) return;
    const pts = [...pointers.current.values()];
    if (pts.length >= 2 && g.dist > 0) {
      g.moved = true;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const zoomed = zoomAt(g.view, g.view.scale * (dist / g.dist), rel(g.mid), s, img);
      apply(clampPan({ ...zoomed, x: zoomed.x + (mid.x - g.mid.x), y: zoomed.y + (mid.y - g.mid.y) }, s, img));
    } else if (pts.length === 1) {
      const dx = pts[0].x - g.start.x;
      const dy = pts[0].y - g.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) g.moved = true;
      if (!isFit(g.view, s, img)) apply(clampPan({ ...g.view, x: g.view.x + dx, y: g.view.y + dy }, s, img));
    }
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 0) {
      // A plain click on the dark area around the image closes the viewer.
      if (g && !g.moved && g.onBackground && e.type === "pointerup") onClose();
      gesture.current = null;
    } else {
      beginGesture(g?.onBackground ?? false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target instanceof HTMLButtonElement && (e.key === "Enter" || e.key === " ")) return;
    const pan = (dx: number, dy: number) => {
      const { stage: s, image: img, view: v } = latest.current;
      if (img && v && !isFit(v, s, img)) apply(clampPan({ ...v, x: v.x + dx, y: v.y + dy }, s, img));
    };
    switch (e.key) {
      case "+":
      case "=":
        zoomBy(STEP);
        break;
      case "-":
      case "_":
        zoomBy(1 / STEP);
        break;
      case "0":
        setView(null);
        break;
      case "ArrowLeft":
        pan(60, 0);
        break;
      case "ArrowRight":
        pan(-60, 0);
        break;
      case "ArrowUp":
        pan(0, 60);
        break;
      case "ArrowDown":
        pan(0, -60);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  function onImgError() {
    if (onExpired && !retried) {
      setRetried(true);
      onExpired();
    } else {
      setFailed(true);
    }
  }

  const btn =
    "flex h-11 min-w-11 items-center justify-center rounded-xl bg-white px-3 text-[15px] font-bold text-khelo-ink disabled:opacity-40 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-khelo-orange";
  const pct = image && effective ? zoomPercent(effective, stage, image) : 100;

  return (
    <ModalShell label={`${t("media.lb.title")}: ${alt}`} onClose={onClose} fullscreen>
      <div className="flex h-full flex-col" onKeyDown={onKeyDown} data-testid="lightbox">
        <div className="flex flex-wrap items-center justify-end gap-2 p-3">
          <span role="status" aria-live="polite" data-testid="lb-zoom" className="mr-auto whitespace-nowrap rounded-lg bg-black/40 px-2.5 py-1 text-[13px] font-semibold text-white">
            {t("media.lb.zoom", { n: pct })}
          </span>
          <button type="button" className={btn} aria-label={t("media.lb.zoomOut")} disabled={atFit} onClick={() => zoomBy(1 / STEP)} data-testid="lb-out">
            <span aria-hidden="true">-</span>
          </button>
          <button type="button" className={btn} aria-label={t("media.lb.zoomIn")} disabled={!image || atMax} onClick={() => zoomBy(STEP)} data-testid="lb-in">
            <span aria-hidden="true">+</span>
          </button>
          <button type="button" className={btn} aria-label={t("media.lb.fitAria")} disabled={atFit} onClick={() => setView(null)} data-testid="lb-fit">
            {t("media.lb.fit")}
          </button>
          <button type="button" className={btn} onClick={onClose} data-testid="lb-close">
            {t("media.lb.close")}
          </button>
        </div>
        <p className="sr-only">{t("media.lb.hint")}</p>
        <div
          ref={stageRef}
          data-testid="lb-stage"
          className={`relative min-h-0 flex-1 touch-none select-none overflow-hidden ${atFit ? "cursor-zoom-in" : "cursor-grab active:cursor-grabbing"}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={(e) => {
            if (e.target === e.currentTarget) return;
            const r = stageRef.current!.getBoundingClientRect();
            if (atFit) zoomBy(2, { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 });
            else setView(null);
          }}
        >
          {failed ? (
            <p role="alert" className="absolute left-1/2 top-1/2 w-[min(90%,24rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-4 text-center text-[14px] font-semibold text-owner-danger">
              {t("media.lb.error")}
            </p>
          ) : (
            <>
              {!image ? (
                <p role="status" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[14px] font-semibold text-white">
                  {t("media.lb.loading")}
                </p>
              ) : null}
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not an optimisable static asset
                <img
                key={src}
                src={src}
                alt={alt}
                data-testid="lb-img"
                referrerPolicy="no-referrer"
                draggable={false}
                onLoad={(e) => setNatural({ src, size: { w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 } })}
                onError={onImgError}
                className="absolute left-1/2 top-1/2 max-w-none rounded-md bg-white"
                style={
                  image && effective
                    ? {
                        width: image.w * effective.scale,
                        height: image.h * effective.scale,
                        transform: `translate(-50%, -50%) translate(${effective.x}px, ${effective.y}px)`,
                      }
                    : { opacity: 0, transform: "translate(-50%, -50%)" }
                }
              />
              ) : null}
            </>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
