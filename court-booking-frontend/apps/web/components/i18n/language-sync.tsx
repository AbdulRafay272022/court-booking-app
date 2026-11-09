"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { useLang } from "@/components/i18n/lang-provider";

/** fix/nov-9 item 6: the server writes push / bell / WhatsApp text in the user's language, so the language this browser shows
 * is saved on the account (at sign-in and whenever it is switched). Best effort: a failure only means the old language stays. */
export function LanguageSync() {
  const lang = useLang();
  const user = useAuthStore((s) => s.user);
  const tried = useRef<string | null>(null);
  useEffect(() => {
    if (!user || user.language === lang) return;
    const key = `${user.id}:${lang}`;
    if (tried.current === key) return;
    tried.current = key;
    api.auth
      .updateMe({ language: lang })
      .then((updated) => useAuthStore.getState().setUser(updated))
      .catch(() => undefined);
  }, [user, lang]);
  return null;
}
