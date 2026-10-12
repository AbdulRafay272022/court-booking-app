import { cookies } from "next/headers";
import { LANG_COOKIE, makeT, parseLang, type Lang, type TFunction } from "./i18n";

/** Server components only: the visitor's language from the `khelo_lang` cookie (default Roman Urdu). Reading cookies makes the page dynamic. */
export async function getLang(): Promise<Lang> {
  const store = await cookies();
  return parseLang(store.get(LANG_COOKIE)?.value);
}

/** `const t = await getT();` then `t("header.features")` in a server component or in `generateMetadata`. */
export async function getT(): Promise<TFunction> {
  return makeT(await getLang());
}
