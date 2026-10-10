"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PremiumFeature } from "@court-booking/types";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";

export default function PremiumPricingPage() {
  const query = useQuery({ queryKey: ["admin-premium-features"], queryFn: () => api.admin.premiumFeatures() });

  return (
    <div className="p-4 sm:p-8 max-w-3xl flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Premium pricing</h1>
        <p className="text-owner-ink-faint text-sm mt-1">
          The monthly price of each premium feature, in PKR. A feature is only offered to owners once it has a price and is
          switched on for sale. An owner keeps the price they signed up at; a new price applies to owners who join after it.
          Nothing is billed until billing enforcement is turned on in Feature flags.
        </p>
      </div>

      {query.isLoading ? (
        <p className="text-owner-ink-faint">Loading…</p>
      ) : query.isError ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="owner" />
      ) : (
        <div className="bg-owner-surface border border-owner-border rounded-xl overflow-hidden">
          {(query.data ?? []).map((f) => (
            <FeatureRow key={f.key} feature={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function FeatureRow({ feature }: { feature: PremiumFeature }) {
  const qc = useQueryClient();
  const [price, setPrice] = useState(String(feature.monthly_price_pkr));
  const [sellable, setSellable] = useState(feature.is_sellable);
  const [saved, setSaved] = useState(false);

  const dirty = Number(price) !== feature.monthly_price_pkr || sellable !== feature.is_sellable;
  const valid = /^\d+$/.test(price) && (!sellable || Number(price) > 0);

  const save = useMutation({
    mutationFn: () => api.admin.updatePremiumFeature(feature.key, { monthly_price_pkr: Number(price), is_sellable: sellable }),
    onSuccess: async () => {
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ["admin-premium-features"] });
    },
  });

  return (
    <div className="flex flex-wrap items-center gap-4 px-5 py-4 border-b border-owner-border-light last:border-0">
      <div className="flex-1 min-w-[200px]">
        <p className="font-semibold text-sm">{feature.label}</p>
        {feature.description ? <p className="text-xs text-owner-ink-faint mt-0.5">{feature.description}</p> : null}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-owner-ink-faint">PKR / month</span>
        <input
          data-testid={`price-${feature.key}`}
          inputMode="numeric"
          value={price}
          onChange={(e) => {
            setPrice(e.target.value.replace(/\D/g, ""));
            setSaved(false);
          }}
          className="w-28 h-10 px-3 rounded-lg border border-owner-border font-mono text-right"
        />
      </label>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input
          data-testid={`sellable-${feature.key}`}
          type="checkbox"
          checked={sellable}
          onChange={(e) => {
            setSellable(e.target.checked);
            setSaved(false);
          }}
          className="w-5 h-5"
        />
        For sale
      </label>
      <button
        data-testid={`save-${feature.key}`}
        disabled={!dirty || !valid || save.isPending}
        onClick={() => save.mutate()}
        className="h-10 px-4 rounded-lg text-sm font-semibold text-white disabled:opacity-40"
        style={{ background: "#0E6274" }}
      >
        {save.isPending ? "Saving…" : saved && !dirty ? "Saved" : "Save"}
      </button>
      {sellable && Number(price) === 0 ? <p className="basis-full text-xs font-semibold text-owner-danger">Set a price above zero to put this on sale.</p> : null}
      {save.isError ? (
        <p role="alert" className="basis-full text-xs font-semibold text-owner-danger">
          {friendlyErrorMessage(save.error)}
        </p>
      ) : null}
    </div>
  );
}
