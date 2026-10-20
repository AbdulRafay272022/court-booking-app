"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useT } from "@/components/i18n/lang-provider";
import { CNIC_IMAGE_TYPES, cnicImageProblem, formatCnic, isValidCnic } from "./cnic";
import type { IdentityDraft } from "./identity-draft-store";

/** Ready to submit: a valid 13-digit number and both photos. */
export function identityDraftReady(d: IdentityDraft): boolean {
  return isValidCnic(d.number) && !!d.front && !!d.back;
}

/**
 * CNIC number (masked 12345-1234567-1 while typing) + front and back photo with a preview. Controlled; the files stay in
 * memory only (the caller keeps them in React state or the non-persisted identity draft store).
 */
export function CnicFields({ value, onChange }: { value: IdentityDraft; onChange: (patch: Partial<IdentityDraft>) => void }) {
  const t = useT();
  const id = useId();
  const [touched, setTouched] = useState(false);
  const invalid = touched && value.number !== "" && !isValidCnic(value.number);
  return (
    <div className="flex flex-col gap-4" data-testid="cnic-fields">
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-num`} className="text-[13px] font-semibold text-owner-ink-muted">
          {t("cnic.field.number")}
        </label>
        <input
          id={`${id}-num`}
          data-testid="cnic-number"
          value={value.number}
          onChange={(e) => onChange({ number: formatCnic(e.target.value) })}
          onBlur={() => setTouched(true)}
          inputMode="numeric"
          autoComplete="off"
          placeholder="12345-1234567-1"
          maxLength={15}
          aria-invalid={invalid}
          aria-describedby={`${id}-num-help${invalid ? ` ${id}-num-err` : ""}`}
          className={`h-12 px-3.5 rounded-[9px] bg-owner-bg border text-[15px] font-mono font-medium text-owner-ink outline-none focus:border-owner-accent focus-visible:ring-2 focus-visible:ring-owner-accent ${
            invalid ? "border-owner-danger" : "border-owner-border"
          }`}
        />
        <p id={`${id}-num-help`} className="text-[12px] text-owner-ink-faint">
          {t("cnic.field.numberHelp")}
        </p>
        {invalid ? (
          <p id={`${id}-num-err`} role="alert" className="text-[12.5px] font-semibold text-owner-danger">
            <span aria-hidden="true">! </span>
            {t("cnic.err.invalid")}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-3">
        <PhotoPick side="front" label={t("cnic.field.front")} file={value.front} onPick={(f) => onChange({ front: f })} />
        <PhotoPick side="back" label={t("cnic.field.back")} file={value.back} onPick={(f) => onChange({ back: f })} />
      </div>
      <p className="text-[12px] text-owner-ink-faint">{t("cnic.privacy")}</p>
    </div>
  );
}

function PhotoPick({ side, label, file, onPick }: { side: "front" | "back"; label: string; file: File | null; onPick: (f: File | null) => void }) {
  const t = useT();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<"type" | "size" | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  // A preview URL for the chosen file, released when the file changes or the field unmounts.
  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the object URL is an external resource tied to this file
    setUrl(u);
    return () => {
      URL.revokeObjectURL(u);
      setUrl(null);
    };
  }, [file]);

  return (
    <div className="flex flex-col gap-2 flex-1 basis-48 min-w-0" data-testid={`cnic-${side}`}>
      <span id={`${id}-label`} className="text-[13px] font-semibold text-owner-ink-muted">
        {label}
      </span>
      <div className="flex aspect-[1.6] w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-owner-border bg-owner-bg">
        {file && url ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimisable asset
          <img src={url} alt={t("cnic.previewAlt", { side: label })} className="h-full w-full object-contain" />
        ) : (
          <span className="px-3 text-center text-[12.5px] text-owner-ink-faint">{t("cnic.field.noPhoto")}</span>
        )}
      </div>
      <input
        ref={inputRef}
        id={`${id}-input`}
        data-testid={`cnic-${side}-input`}
        type="file"
        accept={CNIC_IMAGE_TYPES.join(",")}
        className="sr-only"
        aria-labelledby={`${id}-label`}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          if (!f) return;
          const p = cnicImageProblem(f);
          setProblem(p);
          if (!p) onPick(f);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        aria-describedby={problem ? `${id}-err` : undefined}
        className="min-h-11 rounded-lg border border-owner-border bg-owner-surface px-4 text-[13.5px] font-semibold text-owner-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0C1F1D]"
      >
        {file ? t("cnic.field.change", { side: label }) : t("cnic.field.choose", { side: label })}
      </button>
      {problem ? (
        <p id={`${id}-err`} role="alert" className="text-[12.5px] font-semibold text-owner-danger">
          <span aria-hidden="true">! </span>
          {problem === "type" ? t("cnic.err.photoType") : t("cnic.err.photoSize")}
        </p>
      ) : null}
    </div>
  );
}
