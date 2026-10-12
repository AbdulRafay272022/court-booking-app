import L from "leaflet";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

// A static image import is a plain URL string or an object with `src`, depending on the bundler path; accept both.
const urlOf = (m: unknown): string => (typeof m === "string" ? m : ((m as { src?: string; default?: { src?: string } }).src ?? (m as { default?: { src?: string } }).default?.src ?? ""));

/** Leaflet builds its default icon URLs from its own CSS at runtime, which the bundler breaks; point it at the bundled files. Shared by the Search map and the single-pin venue map. */
export const pinIcon = L.icon({
  iconUrl: urlOf(markerIcon),
  iconRetinaUrl: urlOf(markerIcon2x),
  shadowUrl: urlOf(markerShadow),
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
