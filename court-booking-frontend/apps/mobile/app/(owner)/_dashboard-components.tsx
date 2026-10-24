import { Button, Banner } from "@/components/ui";

const STATUS_COPY: Record<string, string> = {
  pending: "review mein hai. Players abhi ise dhoond ya book nahi kar sakte; walk-in chalte hain.",
  changes_requested: "live hone se pehle kuch tabdeeli chahiye.",
  rejected: "approve nahi hui, is liye players book nahi kar sakte.",
};

/** Shown when the venue being managed is not live: each venue keeps its own status, so this reflects the SELECTED one. */
export function VenueStatusBanner({ venue, onView }: { venue: { name: string; status: string }; onView: () => void }) {
  if (venue.status === "approved") return null;
  return (
    <Banner
      tone={venue.status === "rejected" ? "danger" : "waiting"}
      title={venue.name}
      body={STATUS_COPY[venue.status] ?? "abhi live nahi."}
      action={<Button label="Status dekhein" variant="soft" size="sm" onPress={onView} />}
    />
  );
}
