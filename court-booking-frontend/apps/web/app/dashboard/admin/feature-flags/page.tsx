"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeatureFlag } from "@court-booking/types";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";

export default function FeatureFlagsPage() {
  const qc = useQueryClient();
  const flagsQuery = useQuery({
    queryKey: ["admin-feature-flags"],
    queryFn: () => api.featureFlags.list(),
  });

  const toggle = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      api.featureFlags.setEnabled(key, enabled),
    onMutate: async ({ key, enabled }) => {
      // Optimistic: flip immediately, roll back on error.
      await qc.cancelQueries({ queryKey: ["admin-feature-flags"] });
      const prev = qc.getQueryData<FeatureFlag[]>(["admin-feature-flags"]);
      qc.setQueryData<FeatureFlag[]>(["admin-feature-flags"], (old) =>
        (old ?? []).map((f) => (f.key === key ? { ...f, enabled } : f)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["admin-feature-flags"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin-feature-flags"] }),
  });

  const flags = flagsQuery.data ?? [];

  return (
    <div className="p-4 sm:p-8 max-w-3xl flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Feature flags</h1>
        <p className="text-owner-ink-faint text-sm mt-1">
          Turn a feature off across the whole app instantly — no deploy. Turning one off falls back to
          the documented behavior from before that feature shipped; nothing breaks.
        </p>
      </div>

      {flagsQuery.isLoading ? (
        <p className="text-owner-ink-faint">Loading…</p>
      ) : flagsQuery.isError ? (
        <ErrorState message={friendlyErrorMessage(flagsQuery.error)} onRetry={() => flagsQuery.refetch()} tone="owner" />
      ) : flags.length === 0 ? (
        <p className="text-owner-ink-faint">No feature flags configured.</p>
      ) : (
        <div className="bg-owner-surface border border-owner-border rounded-xl overflow-hidden">
          {flags.map((flag) => (
            <div
              key={flag.key}
              className="flex items-start gap-4 px-5 py-4 border-b border-owner-border-light last:border-0"
            >
              <div className="flex-1">
                <p className="font-semibold text-sm">{flag.label || flag.key}</p>
                {flag.description ? (
                  <p className="text-xs text-owner-ink-faint mt-0.5">{flag.description}</p>
                ) : null}
              </div>
              <Toggle
                testid={`flag-${flag.key}`}
                on={flag.enabled}
                busy={toggle.isPending && toggle.variables?.key === flag.key}
                onChange={(next) => {
                  if (!next && !window.confirm(`Turn OFF "${flag.label || flag.key}" for everyone?`)) return;
                  toggle.mutate({ key: flag.key, enabled: next });
                }}
              />
            </div>
          ))}
        </div>
      )}
      {toggle.isError ? (
        <p role="alert" className="text-sm font-semibold text-owner-danger">
          {friendlyErrorMessage(toggle.error)}
        </p>
      ) : null}
    </div>
  );
}

function Toggle({ on, busy, onChange, testid }: { on: boolean; busy: boolean; onChange: (next: boolean) => void; testid?: string }) {
  return (
    <button
      role="switch"
      data-testid={testid}
      aria-checked={on}
      aria-label={on ? "On" : "Off"}
      disabled={busy}
      onClick={() => onChange(!on)}
      className="shrink-0 w-[52px] h-[30px] rounded-full transition-colors relative"
      style={{ background: on ? "#1F7A52" : "#C6D2D7", opacity: busy ? 0.6 : 1 }}
    >
      <span
        className="absolute top-[3px] w-6 h-6 rounded-full bg-white transition-all"
        style={{ left: on ? "25px" : "3px" }}
      />
    </button>
  );
}
