import { useEffect, useRef } from "react";
import { useLang } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

/** fix/nov-9 item 6: push / bell / WhatsApp text is written by the server in the account's language, so the language this app
 * shows is saved on the account (on start and whenever it is switched). Best effort: a failure keeps the old language. */
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
