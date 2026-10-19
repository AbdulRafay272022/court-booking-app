"use client";

import { useT } from "@/components/i18n/lang-provider";
import type { DefaultState } from "./hint-state";

/**
 * Round 2 Stage 2 (spec A.2): the small line under a setting field.
 * - always: "Default: 15 minute";
 * - nothing set (or, for fields that can never be empty, the value equals the default): "Abhi default chal raha hai";
 * - the owner's value differs: a "Default par wapas" button (44px target) that calls `onReset`.
 * The marker carries text and an icon, never colour alone.
 */
export function DefaultHint({
  id,
  field,
  text,
  state,
  onReset,
  markSame = true,
  note,
}: {
  /** data-testid suffix, e.g. "hold_minutes". */
  id: string;
  /** The field's own label, for the reset button's accessible name. */
  field: string;
  /** The default, already formatted ("15 minute"). */
  text: string;
  state: DefaultState;
  onReset?: () => void;
  /** Treat "value equals the default" as "default running" (true for fields that can never be empty). */
  markSame?: boolean;
  /** Extra line after the default, e.g. "abhi poori raqam". */
  note?: string | null;
}) {
  const t = useT();
  const running = state === "unset" || (markSame && state === "same");
  return (
    <div data-testid={`default-hint-${id}`} data-state={state} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-owner-ink-faint">
      <span>
        {t("set2.default", { value: text })}
        {note ? <span data-testid={`default-note-${id}`}>{` (${note})`}</span> : null}
      </span>
      {running ? (
        <span
          data-testid={`default-running-${id}`}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-owner-border bg-owner-bg px-2 py-0.5 text-[11.5px] font-semibold text-owner-ink-muted"
        >
          <span aria-hidden="true">&#10003;</span>
          {t("set2.usingDefault")}
        </span>
      ) : null}
      {state === "differs" && onReset ? (
        <button
          type="button"
          data-testid={`default-reset-${id}`}
          aria-label={t("set2.resetAria", { field })}
          onClick={onReset}
          className="inline-flex min-h-11 items-center whitespace-nowrap rounded px-1 text-[12.5px] font-semibold text-owner-accent underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0C1F1D]"
        >
          {t("set2.reset")}
        </button>
      ) : null}
    </div>
  );
}
