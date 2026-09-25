import type { FeatureFlag, PublicFlags } from "@court-booking/types";
import type { ApiClient } from "./client";

export function createFeatureFlagsApi(client: ApiClient) {
  return {
    // Public: the on/off map, for gating UI. No auth required.
    publicFlags: () => client.request<PublicFlags>("/feature-flags"),

    // Admin-only.
    list: () => client.request<FeatureFlag[]>("/admin/feature-flags"),

    setEnabled: (key: string, enabled: boolean) =>
      client.request<FeatureFlag>(`/admin/feature-flags/${key}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
  };
}
