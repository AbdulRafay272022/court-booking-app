// Generates apps/web/components/fl/icons.tsx from lucide icon data (ISC).
// Usage (from court-booking-frontend): node apps/web/scripts/gen-fl-icons.mjs node_modules/lucide-react-native/dist/esm/icons apps/web/components/fl/icons.tsx
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [dir, out] = process.argv.slice(2);
const names = {
  Heart: "heart", ChevronLeft: "chevron-left", ChevronRight: "chevron-right", X: "x", Check: "check", List: "list", Lock: "lock",
  Hourglass: "hourglass", UserCheck: "user-check", CircleAlert: "circle-alert", WifiOff: "wifi-off", Inbox: "inbox", ArrowLeft: "arrow-left",
  Minus: "minus", Plus: "plus", Copy: "copy", Info: "info", SquareParking: "square-parking", Toilet: "toilet", Shirt: "shirt",
  Lightbulb: "lightbulb", Droplet: "droplet", Coffee: "coffee", Warehouse: "warehouse", Armchair: "armchair", Wifi: "wifi",
  Volleyball: "volleyball", Moon: "moon", Search: "search", Bell: "bell", MessageCircle: "message-circle", Settings: "settings",
};
let body = "";
for (const [comp, file] of Object.entries(names)) {
  const src = readFileSync(join(dir, file + ".mjs"), "utf8");
  const lit = src.slice(src.indexOf("const __iconData = ") + "const __iconData = ".length, src.indexOf("};", src.indexOf("const __iconData")) + 1);
  const data = Function("return (" + lit + ")")();
  const nodes = data.node.map(([tag, attrs]) => {
    const { key, ...rest } = attrs;
    return [tag, rest];
  });
  body += `export const ${comp} = icon(${JSON.stringify(nodes)});\n`;
}
const head = `/* Lucide icons (ISC license, lucide.dev) as inline SVG for the web fl components. GENERATED from lucide v1.61 icon data
   (same icons as lucide-react-native on mobile); add more by extending the generator, never by hand-drawing. */
import { createElement, type SVGProps } from "react";

export type IconNode = [string, Record<string, string>][];
export interface FlIconProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  size?: number;
  strokeWidth?: number;
}
export type FlIcon = (p: FlIconProps) => React.ReactElement;

function icon(node: IconNode): FlIcon {
  function Icon({ size = 20, strokeWidth = 2, ...rest }: FlIconProps) {
    return createElement(
      "svg",
      { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: false, ...rest },
      node.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs })),
    );
  }
  return Icon;
}

`;
writeFileSync(out, head + body);
console.log("wrote", Object.keys(names).length, "icons");
