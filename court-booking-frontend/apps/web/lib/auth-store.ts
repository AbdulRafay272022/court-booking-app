import { create } from "zustand";
import type { Session, User } from "@court-booking/types";

const TOKEN_KEY = "maidan.session_token";
const EXPIRES_KEY = "maidan.session_expires_at";
const USER_KEY = "maidan.cached_user";

/** Deliberate, documented tradeoff (Section 9.3): a bearer token in localStorage is
 * readable by injected JS (XSS risk) vs. the httpOnly-cookie-via-API-route approach
 * the spec prefers. Chosen here to keep the pilot's surface area small -- the same
 * tradeoff the mobile app doesn't have to make (SecureStore is safe by default) but
 * web explicitly allows deferring. Revisit before scaling past the pilot.
 *
 * Section 26: sessions now last 8h, so the expiry is stored next to the token (the
 * proactive refresh needs it), and the last-known user is cached so a flaky network on
 * page load doesn't have to mean "logged out" -- see `unreachable` below. */
export type AuthStatus =
  | "hydrating"
  | "signedOut"
  | "signedIn"
  /** A stored session exists but the server couldn't be reached to confirm it (after
   * retries), and there's no cached user to show. NOT signed out: the token is kept. */
  | "unreachable";

interface AuthState {
  status: AuthStatus;
  user: User | null;
  session: Session | null;
  token: string | null;
  /** ISO time the current token stops working (drives proactive refresh). */
  expiresAt: string | null;
  hasHydrated: boolean;
  hydrate: () => void;
  signIn: (token: string, user: User, expiresAt: string) => void;
  signOut: () => void;
  setToken: (token: string, expiresAt?: string) => void;
  setUser: (user: User, session?: Session) => void;
  /** Server unreachable while confirming a stored session: keep the token, run on the cached user. */
  markUnreachable: () => void;
}

function readCachedUser(): User | null {
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: User | null) {
  try {
    if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(USER_KEY);
  } catch {
    // Storage full/blocked: the cache is a convenience, never required.
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "hydrating",
  user: null,
  session: null,
  token: null,
  expiresAt: null,
  hasHydrated: false,

  hydrate: () => {
    if (typeof window === "undefined") return;
    const token = window.localStorage.getItem(TOKEN_KEY);
    if (!token) {
      set({ status: "signedOut", hasHydrated: true });
      return;
    }
    // Token first, so the api-client's getToken() sees it for the /auth/me call the
    // caller (Providers) is about to make; status flips once that resolves.
    set({ token, expiresAt: window.localStorage.getItem(EXPIRES_KEY), hasHydrated: true });
  },

  signIn: (token, user, expiresAt) => {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(EXPIRES_KEY, expiresAt);
    writeCachedUser(user);
    set({ token, user, expiresAt, status: "signedIn" });
  },

  signOut: () => {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(EXPIRES_KEY);
    writeCachedUser(null);
    set({ token: null, user: null, session: null, expiresAt: null, status: "signedOut" });
  },

  setToken: (token, expiresAt) => {
    window.localStorage.setItem(TOKEN_KEY, token);
    if (expiresAt) window.localStorage.setItem(EXPIRES_KEY, expiresAt);
    set({ token, ...(expiresAt ? { expiresAt } : {}) });
  },

  setUser: (user, session) => {
    writeCachedUser(user);
    set({ user, session, status: "signedIn" });
  },

  markUnreachable: () => {
    if (get().status !== "hydrating") return;
    const cached = readCachedUser();
    if (cached) set({ user: cached, status: "signedIn" });
    else set({ status: "unreachable" });
  },
}));

export function getAuthState() {
  return useAuthStore.getState();
}
