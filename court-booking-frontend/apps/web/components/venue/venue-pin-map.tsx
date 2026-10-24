"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useT } from "@/components/i18n/lang-provider";
import { pinIcon, OSM_ATTRIBUTION, OSM_TILES } from "./leaflet-pin";

/**
 * One venue, one pin, on OpenStreetMap tiles through Leaflet (loaded lazily by VenueLocation; no keys, nothing paid).
 *
 * The map must never trap the page scroll:
 * - scroll-wheel zoom is off; on a desktop it only zooms while Ctrl (or Cmd) is held, otherwise the wheel scrolls the page;
 * - on a touch screen the map starts locked (one finger scrolls the page); "Tap to use the map" unlocks dragging and pinch-zoom,
 *   and "Lock map" locks it again.
 */
export default function VenuePinMap({ lat, lng, name }: { lat: number; lng: number; name: string }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const t = useT();
  // a touch screen (coarse pointer) starts with the map locked; only known in the browser
  const touch = useSyncExternalStore(() => () => {}, () => window.matchMedia("(pointer: coarse)").matches, () => false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!el.current) return;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const map = L.map(el.current, {
      scrollWheelZoom: false,
      dragging: !coarse,
      touchZoom: !coarse,
      center: [lat, lng],
      zoom: 15,
    });
    mapRef.current = map;
    L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);
    L.marker([lat, lng], { icon: pinIcon, title: name, alt: name }).addTo(map);


    // Ctrl/Cmd + wheel zooms; a plain wheel is left alone so the page keeps scrolling.
    const node = el.current;
    let lastZoomAt = 0;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const now = Date.now();
      if (now - lastZoomAt < 120) return;
      lastZoomAt = now;
      map.setZoom(map.getZoom() + (e.deltaY < 0 ? 1 : -1));
    };
    node.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      node.removeEventListener("wheel", onWheel);
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lng, name]);

  function setLocked(locked: boolean) {
    const map = mapRef.current;
    if (!map) return;
    if (locked) {
      map.dragging.disable();
      map.touchZoom.disable();
    } else {
      map.dragging.enable();
      map.touchZoom.enable();
    }
    setActive(!locked);
  }

  return (
    <div className="relative">
      <div
        ref={el}
        role="region"
        aria-label={t("venue.loc.mapLabel", { name })}
        data-testid="venue-pin-map"
        className="z-0 h-[260px] w-full overflow-hidden rounded-3xl bg-fl-ground md:h-[340px]"
      />
      {touch && !active ? (
        <button
          type="button"
          onClick={() => setLocked(false)}
          data-testid="map-activate"
          className="absolute inset-0 z-[1100] flex items-end justify-center rounded-3xl bg-transparent p-3 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-fl-orange"
        >
          <span className="rounded-full bg-fl-night px-4 py-2.5 text-[13px] font-bold text-fl-white">{t("venue.loc.tapToUse")}</span>
        </button>
      ) : null}
      {touch && active ? (
        <button
          type="button"
          onClick={() => setLocked(true)}
          data-testid="map-lock"
          className="khelo-btn absolute right-3 top-3 z-[1100] inline-flex min-h-11 items-center rounded-full bg-fl-night px-4 text-[13px] font-extrabold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fl-orange"
        >
          {t("venue.loc.lockMap")}
        </button>
      ) : null}
    </div>
  );
}
