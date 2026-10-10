import type { OwnerPremium } from "@court-booking/types";
import type { ApiClient } from "./client";

export function createPremiumApi(client: ApiClient) {
  return {
    /** The premium features this owner can buy, what is switched on, the monthly total and invoices. */
    get: () => client.request<OwnerPremium>("/owners/premium"),

    /** Set the COMPLETE list of features the owner wants on. Enabling starts a free trial; leaving one out cancels it. */
    setSelection: (featureKeys: string[]) =>
      client.request<OwnerPremium>("/owners/premium/selection", {
        method: "PUT",
        body: JSON.stringify({ feature_keys: featureKeys }),
      }),
  };
}
