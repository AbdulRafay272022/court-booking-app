"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/site/button";
import { useT } from "@/components/i18n/lang-provider";
import { coordsOf, directionsUrl, pointUrl, shareText, whatsappShareUrl } from "@/lib/venue-location";

// Leaflet touches `window` and brings its own CSS, so the map is fetched only in the browser, only on a venue page that has coordinates.
const VenuePinMap = dynamic(() => import("./venue-pin-map"), {
  ssr: false,
  loading: () => <div className="h-[260px] w-full animate-pulse rounded-3xl bg-fl-line md:h-[340px]" aria-hidden="true" />,
});

const subscribeNever = () => () => {};
const canWebShare = () => typeof navigator !== "undefined" && typeof navigator.share === "function";

/**
 * The venue page's "Location" section. With coordinates: a one-pin map, the venue name and address under it, and three
 * actions (Directions, Share location, or WhatsApp + Copy link where the browser can't share). Without coordinates: the
 * address as text only, no map and no buttons that need a point. Only the venue's own public data is ever shared.
 */
export function VenueLocation({
  name,
  address,
  area,
  city,
  latitude,
  longitude,
}: {
  name: string;
  address: string;
  area: string | null;
  city: string;
  latitude?: number | null;
  longitude?: number | null;
}) {
  const t = useT();
  const coords = coordsOf({ latitude, longitude });
  const shareable = useSyncExternalStore(subscribeNever, canWebShare, () => false);
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function say(message: string) {
    setStatus(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(""), 3500);
  }

  const place = [area && area !== city ? area : null, city].filter(Boolean).join(", ");

  if (!coords) {
    return (
      <section className="flex flex-col gap-3" aria-labelledby="venue-location-title" data-testid="venue-location">
        <h2 id="venue-location-title" className="font-khelo-display text-[26px] font-extrabold tracking-[-0.5px]">
          {t("venue.loc.title")}
        </h2>
        <p className="text-[15px] text-fl-muted">
          <span className="font-bold text-fl-night">{name}</span>
          <br />
          {address}
          {place ? <>, {place}</> : null}
        </p>
      </section>
    );
  }

  const text = shareText(name, area, city);
  const mapUrl = pointUrl(coords);

  async function onShare() {
    try {
      await navigator.share({ title: name, text, url: mapUrl });
    } catch {
      // the visitor closed the share sheet: nothing to report
    }
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(mapUrl);
      say(t("venue.loc.copied"));
    } catch {
      say(t("venue.loc.copyFailed"));
    }
  }

  return (
    <section className="flex flex-col gap-3.5" aria-labelledby="venue-location-title" data-testid="venue-location">
      <h2 id="venue-location-title" className="font-khelo-display text-[26px] font-extrabold tracking-[-0.5px]">
        {t("venue.loc.title")}
      </h2>
      <VenuePinMap lat={coords.lat} lng={coords.lng} name={name} />
      <p className="hidden text-[12.5px] text-fl-muted2 [@media(pointer:fine)]:block">{t("venue.loc.ctrlHint")}</p>
      <p className="text-[15px] text-fl-muted">
        <span className="font-bold text-fl-night">{name}</span>
        <br />
        {address}
        {place ? <>, {place}</> : null}
      </p>
      <div className="flex flex-wrap gap-2.5">
        <Button href={directionsUrl(coords)} variant="primary" pill data-testid="directions-link">
          {t("venue.loc.directions")}
        </Button>
        {shareable ? (
          <Button variant="outlineDark" pill onClick={onShare} data-testid="share-location">
            {t("venue.loc.share")}
          </Button>
        ) : (
          <>
            <Button href={whatsappShareUrl(text, mapUrl)} variant="outlineDark" pill data-testid="share-whatsapp">
              {t("venue.loc.whatsapp")}
            </Button>
            <Button variant="outlineDark" pill onClick={onCopy} data-testid="copy-link">
              {t("venue.loc.copy")}
            </Button>
          </>
        )}
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-[13px] font-bold text-fl-night" data-testid="location-status">
        {status}
      </p>
    </section>
  );
}
