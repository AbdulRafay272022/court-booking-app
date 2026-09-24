"use client";

import { useRef, useState } from "react";
import { compressImage } from "@/lib/compress-image";
import { friendlyErrorMessage } from "@/lib/error-messages";

/** Section 32 Part 6: venue/court photo management -- add (compressed client-side),
 * delete, reorder, set cover (index 0). Presentational; the parent wires onUpload/
 * onReorder to the api-client + query invalidation and passes the fresh urls/keys. */
export function PhotoManager({
  label,
  photoUrls,
  photoKeys,
  max,
  onUpload,
  onReorder,
}: {
  label: string;
  photoUrls: string[];
  photoKeys: string[];
  max: number;
  onUpload: (blob: Blob) => Promise<void>;
  onReorder: (keys: string[]) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const atLimit = photoKeys.length >= max;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    await run(async () => {
      const blob = await compressImage(file);
      await onUpload(blob);
    });
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= photoKeys.length) return;
    const next = [...photoKeys];
    const [k] = next.splice(from, 1);
    next.splice(to, 0, k);
    return run(() => onReorder(next));
  };
  const setCover = (i: number) => move(i, 0);
  const remove = (i: number) => run(() => onReorder(photoKeys.filter((_, idx) => idx !== i)));

  return (
    <div className="flex flex-col gap-3" data-testid={`photos-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex items-center justify-between">
        <p className="text-[13.5px] font-semibold text-owner-ink-muted">{label}</p>
        <span className="text-[12px] text-owner-ink-faint">{photoKeys.length}/{max}</span>
      </div>

      {photoUrls.length === 0 ? (
        <p className="text-owner-ink-faint text-[13px]">No photos yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photoUrls.map((url, i) => (
            <div key={photoKeys[i] ?? url} className="rounded-xl overflow-hidden border border-owner-border bg-owner-surface">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`${label} photo ${i + 1}`} className="w-full h-28 object-cover" />
                {i === 0 ? (
                  <span className="absolute top-1.5 left-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-owner-accent text-white">
                    COVER
                  </span>
                ) : null}
              </div>
              <div className="flex items-center justify-between px-2 py-1.5 gap-1">
                <div className="flex gap-1">
                  <button aria-label="Move left" disabled={busy || i === 0} onClick={() => move(i, i - 1)}
                    className="text-owner-ink-muted disabled:opacity-30 text-sm px-1">◀</button>
                  <button aria-label="Move right" disabled={busy || i === photoKeys.length - 1} onClick={() => move(i, i + 1)}
                    className="text-owner-ink-muted disabled:opacity-30 text-sm px-1">▶</button>
                  {i !== 0 ? (
                    <button aria-label="Set as cover" disabled={busy} onClick={() => setCover(i)}
                      className="text-owner-accent text-[11px] font-semibold disabled:opacity-40">Cover</button>
                  ) : null}
                </div>
                <button aria-label="Delete photo" disabled={busy} onClick={() => remove(i)}
                  className="text-owner-danger text-[11px] font-semibold disabled:opacity-40">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {error ? <p role="alert" className="text-[13px] font-semibold text-owner-danger">{error}</p> : null}

      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onFile} />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy || atLimit}
        className="self-start px-4 h-10 rounded-xl font-semibold border border-owner-border text-owner-ink disabled:opacity-40"
      >
        {busy ? "Working…" : atLimit ? `Limit ${max} reached` : "+ Add photo"}
      </button>
    </div>
  );
}
