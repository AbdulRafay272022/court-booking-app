import type { OwnerPremium } from "@court-booking/types";
import type { ApiClient } from "./client";

export function createPremiumApi(client: ApiClient) {
  return {
    /** The premium features this owner can buy, what is switched on, the monthly total and invoices. */
    get: () => client.request<OwnerPremium>("/owners/premium"),

    /** Set the COMPLETE list of features the owner wants on. Enabling starts a free trial; leaving one out cancels it. */
    /** Upload the screenshot of a payment for an invoice. An admin checks it. `file` is a uri string on native, a Blob/File on web. */
    submitInvoiceProof: (
      invoiceId: string,
      file: string | Blob,
      fileName = "proof.jpg",
      mimeType = "image/jpeg",
      onProgress?: (fraction: number) => void,
    ) => {
      const formData = new FormData();
      const part = typeof file === "string" ? ({ uri: file, name: fileName, type: mimeType } as unknown as Blob) : file;
      formData.append("image", part, fileName);
      return client.requestUpload<OwnerPremium>(`/owners/premium/invoices/${invoiceId}/payment-proof`, formData, onProgress);
    },

    setSelection: (featureKeys: string[]) =>
      client.request<OwnerPremium>("/owners/premium/selection", {
        method: "PUT",
        body: JSON.stringify({ feature_keys: featureKeys }),
      }),
  };
}
