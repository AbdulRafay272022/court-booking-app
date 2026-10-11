"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import type { MapVenue } from "@/lib/map-venues";
import { formatPKR } from "@/lib/format";

// A static image import is a plain URL string or an object with `src`, depending on the bundler path; accept both.
const urlOf = (m: unknown): string => (typeof m === "string" ? m : ((m as { src?: string; default?: { src?: string } }).src ?? (m as { default?: { src?: string } }).default?.src ?? ""));

// Leaflet builds its default icon URLs from its own CSS at runtime, which the bundler breaks; point it at the bundled files.
const pinIcon = L.icon({
  iconUrl: urlOf(markerIcon),
  iconRetinaUrl: urlOf(markerIcon2x),
  shadowUrl: urlOf(markerShadow),
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

/** The popup is built from DOM nodes (never an HTML string), so a venue name can't inject markup. */
function popupFor(p: MapVenue): HTMLElement {
  const box = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = p.name;
  const price = document.createElement("div");
  price.textContent = p.minPrice != null ? `From PKR ${formatPKR(p.minPrice)} / slot` : "Price on request";
  const link = document.createElement("a");
  link.href = p.href;
  link.textContent = "View venue →";
  link.style.display = "inline-block";
  link.style.padding = "10px 0";
  link.style.fontWeight = "700";
  box.append(name, price, link);
  return box;
}

/** OpenStreetMap tiles through Leaflet, one pin per venue. Loaded only when the Map view is opened. */
export default function VenueMap({ pins }: { pins: MapVenue[] }) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!el.current || pins.length === 0) return;
    const map = L.map(el.current, { scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    const points = pins.map((p) => {
      L.marker([p.lat, p.lng], { icon: pinIcon, title: p.name, alt: p.name }).bindPopup(popupFor(p)).addTo(map);
      return L.latLng(p.lat, p.lng);
    });
    if (points.length === 1) map.setView(points[0], 15);
    else map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 });
    return () => {
      map.remove();
    };
  }, [pins]);

  return <div ref={el} role="region" aria-label="Map of venues" data-testid="venue-map" className="z-0 h-[min(70vh,560px)] w-full overflow-hidden rounded-3xl bg-khelo-page" />;
}
