"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapVenue } from "@/lib/map-venues";
import { formatPKR } from "@/lib/format";
import { useT } from "@/components/i18n/lang-provider";
import { pinIcon, OSM_ATTRIBUTION, OSM_TILES } from "@/components/venue/leaflet-pin";
import type { TFunction } from "@/lib/i18n";

/** The popup is built from DOM nodes (never an HTML string), so a venue name can't inject markup. */
function popupFor(p: MapVenue, t: TFunction): HTMLElement {
  const box = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = p.name;
  const price = document.createElement("div");
  price.textContent = p.minPrice != null ? t("venue.map.from", { price: formatPKR(p.minPrice) }) : t("venue.card.priceOnRequest");
  const link = document.createElement("a");
  link.href = p.href;
  link.textContent = t("venue.map.view");
  link.style.display = "inline-block";
  link.style.padding = "10px 0";
  link.style.fontWeight = "700";
  box.append(name, price, link);
  return box;
}

/** OpenStreetMap tiles through Leaflet, one pin per venue. Loaded only when the Map view is opened. */
export default function VenueMap({ pins }: { pins: MapVenue[] }) {
  const el = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    if (!el.current || pins.length === 0) return;
    const map = L.map(el.current, { scrollWheelZoom: false });
    L.tileLayer(OSM_TILES, {
      maxZoom: 19,
      attribution: OSM_ATTRIBUTION,
    }).addTo(map);
    const points = pins.map((p) => {
      L.marker([p.lat, p.lng], { icon: pinIcon, title: p.name, alt: p.name }).bindPopup(popupFor(p, t)).addTo(map);
      return L.latLng(p.lat, p.lng);
    });
    if (points.length === 1) map.setView(points[0], 15);
    else map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 });
    return () => {
      map.remove();
    };
  }, [pins, t]);

  return <div ref={el} role="region" aria-label={t("venue.map.label")} data-testid="venue-map" className="z-0 h-[min(70vh,560px)] w-full overflow-hidden rounded-3xl bg-khelo-page" />;
}
