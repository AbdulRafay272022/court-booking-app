import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tailwindCjs, themeCss } from "../src/generate";

const out = join(__dirname, "..", "generated");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "tailwind.cjs"), tailwindCjs());
writeFileSync(join(out, "theme.css"), themeCss());
console.log("wrote", join(out, "tailwind.cjs"), "and theme.css");
