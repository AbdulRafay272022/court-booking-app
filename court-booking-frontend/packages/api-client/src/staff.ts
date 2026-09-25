import type { StaffCreateInput, StaffMember, StaffPermissionCatalogItem } from "@court-booking/types";
import type { ApiClient } from "./client";

export function createStaffApi(client: ApiClient) {
  return {
    list: () => client.request<StaffMember[]>("/staff"),

    permissionCatalog: () => client.request<StaffPermissionCatalogItem[]>("/staff/permissions"),

    get: (id: string) => client.request<StaffMember>(`/staff/${id}`),

    create: (input: StaffCreateInput) =>
      client.request<StaffMember>("/staff", { method: "POST", body: JSON.stringify(input) }),

    setPermissions: (id: string, permissions: string[]) =>
      client.request<StaffMember>(`/staff/${id}/permissions`, {
        method: "PATCH",
        body: JSON.stringify({ permissions }),
      }),

    setActive: (id: string, isActive: boolean) =>
      client.request<StaffMember>(`/staff/${id}/active`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: isActive }),
      }),
  };
}
