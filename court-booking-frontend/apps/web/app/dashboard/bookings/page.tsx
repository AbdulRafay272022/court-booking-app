import { Suspense } from "react";
import { HistoryPage } from "@/components/owner/history/history-page";

export default function BookingsHistoryRoute() {
  // useSearchParams (every filter is in the URL) needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <HistoryPage />
    </Suspense>
  );
}
