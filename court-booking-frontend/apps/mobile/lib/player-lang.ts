import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** The player's language choice (PAccount "Zabaan": Roman Urdu / English). Roman Urdu is the default, like the website.
 * Device-local (no server field exists for it); the (player) and (auth) layouts feed it to <LangProvider>. */
export type PlayerLang = "ru" | "en";

interface PlayerLangState {
  lang: PlayerLang;
  setLang: (lang: PlayerLang) => void;
}

export const usePlayerLang = create<PlayerLangState>()(
  persist(
    (set) => ({
      lang: "ru",
      setLang: (lang) => set({ lang: lang === "en" ? "en" : "ru" }),
    }),
    { name: "khelo.player_lang", version: 1, storage: createJSONStorage(() => AsyncStorage) },
  ),
);
