import { create } from "zustand";
import type { Session, User } from "@court-booking/types";

const TOKEN_KEY = "maidan.session_token";

/** Deliberate, documented tradeoff (Section 9.3): a bearer token in localStorage is
 * readable by injected JS (XSS risk) vs. the httpOnly-cookie-via-API-route approach
 * the spec prefers. Chosen here to keep the pilot's surface area small -- the same
 * tradeoff the mobile app doesn't have to make (SecureStore is safe by default) but
 * web explicitly allows deferring. Revisit before scaling past the pilot. */
export type AuthStatus = "hydrating" | "signedOut" | "signedIn";

interface AuthState {
  status: AuthStatus;
  user: User | null;
  session: Session | null;
  token: string | null;
  hasHydrated: boolean;
  hydrate: () => void;
  signIn: (token: string, user: User) => void;
  signOut: () => void;
  setToken: (token: string) => void;
  setUser: (user: User, session?: Session) => void;
  markUnverified: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "hydrating",
  user: null,
  session: null,
  token: null,
  hasHydrated: false,

  hydrate: () => {
    if (typeof window === "undefined") return;
    const token = window.localStorage.getItem(TOKEN_KEY);
    if (!token) {
      set({ status: "signedOut", hasHydrated: true });
      return;
    }
    set({ token, hasHydrated: true });
  },

  signIn: (token, user) => {
    window.localStorage.setItem(TOKEN_KEY, token);
    set({ token, user, status: "signedIn" });
  },

  signOut: () => {
    window.localStorage.removeItem(TOKEN_KEY);
    set({ token: null, user: null, session: null, status: "signedOut" });
  },

  setToken: (token) => {
    window.localStorage.setItem(TOKEN_KEY, token);
    set({ token });
  },

  setUser: (user, session) => {
    set({ user, session, status: "signedIn" });
  },

  markUnverified: () => {
    if (get().status === "hydrating") set({ status: "signedOut" });
  },
}));

export function getAuthState() {
  return useAuthStore.getState();
}
