import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * OwnerMore "Zabaan": Roman Urdu (default) or English for the owner side. It feeds the Floodlight <LangProvider> in
 * app/(owner)/_layout.tsx, so every copy built into @/components/ui (Wapas/Back, Band karein/Close, error and empty
 * states) follows it. Owner screen copy itself is Roman Urdu for now; the More screen says so.
 */
export const useOwnerLang = create<{ lang: "ru" | "en"; setLang: (l: "ru" | "en") => void }>()(
  persist((set) => ({ lang: "ru", setLang: (lang) => set({ lang }) }), { name: "maidan.owner_lang", storage: createJSONStorage(() => AsyncStorage) }),
);
