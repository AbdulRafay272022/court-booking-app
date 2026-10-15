import { makeFmt, type Fmt } from "./format-i18n";
import { getLang } from "./i18n-server";

/** Server components: `const fmt = await getFmt();` (reads the language cookie, like `getT()`). */
export async function getFmt(): Promise<Fmt> {
  return makeFmt(await getLang());
}
