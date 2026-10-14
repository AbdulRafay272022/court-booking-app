"use client";

import { useRef, useState } from "react";
import { compressImage } from "@/lib/compress-image";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useT } from "@/components/i18n/lang-provider";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Section 32 Part 6: venue/court photo management -- add (compressed client-side),
 * delete, reorder, set cover (index 0). Presentational; the parent wires onUpload/
 * onReorder to the api-client + query invalidation and passes the fresh urls/keys. */
export function PhotoManager({
  label,
  testKey,
  photoUrls,
  photoKeys,
  max,
  onUpload,
  onReorder,
}: {
  label: string;
  /** Stable (English) key for the data-testid; defaults to `label`. Pass it when `label` is translated. */
  testKey?: string;
  photoUrls: string[];
  photoKeys: string[];
  max: number;
  onUpload: (blob: Blob) => Promise<void>;
  onReorder: (keys: string[]) => Promise<void>;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const atLimit = photoKeys.length >= max;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(friendlyErrorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  // Several images can be picked at once. Each is checked (type, 5MB after compression) and uploaded on its own, so
  // one bad file never stops the others; the room left under the photo limit is honoured as files go up.
  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same files
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    const problems: string[] = [];
    let room = max - photoKeys.length;
    let done = 0;
    let n = 0;
    for (const file of files) {
      n += 1;
      if (!ALLOWED_TYPES.includes(file.type)) {
        problems.push(t("setup.photos.badType", { file: file.name }));
        continue;
      }
      if (room <= 0) {
        problems.push(t("setup.photos.limitSkipped", { file: file.name, max }));
        continue;
      }
      setProgress(t("setup.photos.uploading", { n, total: files.length }));
      try {
        const blob = await compressImage(file);
        if (blob.size > MAX_BYTES) {
          problems.push(t("setup.photos.tooLarge", { file: file.name }));
          continue;
        }
        await onUpload(blob);
        room -= 1;
        done += 1;
      } catch (err) {
        problems.push(`${file.name}: ${friendlyErrorMessage(err, t)}`);
      }
    }
    setProgress(null);
    setBusy(false);
    if (problems.length > 0) {
      setError(`${done > 0 ? `${t("setup.photos.uploadedCount", { done, total: files.length })} ` : ""}${problems.join(" ")}`);
    }
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
    <div className="flex flex-col gap-3" data-testid={`photos-${(testKey ?? label).toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex items-center justify-between">
        <p className="text-[13.5px] font-semibold text-owner-ink-muted">{label}</p>
        <span className="text-[12px] text-owner-ink-faint">{photoKeys.length}/{max}</span>
      </div>

      {photoUrls.length === 0 ? (
        <p className="text-owner-ink-faint text-[13px]">{t("setup.photos.none")}</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photoUrls.map((url, i) => (
            <div key={photoKeys[i] ?? url} className="rounded-xl overflow-hidden border border-owner-border bg-owner-surface">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={t("setup.photos.alt", { label, n: i + 1 })} className="w-full h-28 object-cover" />
                {i === 0 ? (
                  <span className="absolute top-1.5 left-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-owner-accent text-white">
                    {t("setup.photos.coverBadge")}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center justify-between px-2 py-1.5 gap-1">
                <div className="flex gap-1">
                  <button aria-label={t("setup.photos.moveLeft")} disabled={busy || i === 0} onClick={() => move(i, i - 1)}
                    className="text-owner-ink-muted disabled:opacity-30 text-sm px-1">◀</button>
                  <button aria-label={t("setup.photos.moveRight")} disabled={busy || i === photoKeys.length - 1} onClick={() => move(i, i + 1)}
                    className="text-owner-ink-muted disabled:opacity-30 text-sm px-1">▶</button>
                  {i !== 0 ? (
                    <button aria-label={t("setup.photos.setCoverAria")} disabled={busy} onClick={() => setCover(i)}
                      className="text-owner-accent text-[11px] font-semibold disabled:opacity-40">{t("setup.photos.cover")}</button>
                  ) : null}
                </div>
                <button aria-label={t("setup.photos.deleteAria")} disabled={busy} onClick={() => remove(i)}
                  className="text-owner-danger text-[11px] font-semibold disabled:opacity-40">{t("setup.photos.delete")}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {error ? <p role="alert" className="text-[13px] font-semibold text-owner-danger">{error}</p> : null}

      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={onFiles} />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy || atLimit}
        className="self-start px-4 h-10 rounded-xl font-semibold border border-owner-border text-owner-ink disabled:opacity-40"
      >
        {busy ? (progress ?? t("setup.photos.working")) : atLimit ? t("setup.photos.limit", { max }) : t("setup.photos.add")}
      </button>
    </div>
  );
}
