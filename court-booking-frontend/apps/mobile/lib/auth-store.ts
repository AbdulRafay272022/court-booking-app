import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import * as SecureStore from "./secure-storage";
import type { Session, User } from "@court-booking/types";

const TOKEN_KEY = "maidan.session_token";
const EXPIRES_KEY = "maidan.session_expires_at";
const USER_KEY = "maidan.cached_user";

/** "unreachable": a stored session exists but the server couldn't be reached to confirm it
 * (after retries) and there's no cached profile to show. NOT signed out -- the token is kept,
 * and the root layout offers a retry rather than the login screen (an OTP/login costs real
 * effort and wouldn't fix a network problem). */
export type AuthStatus = "hydrating" | "signedOut" | "signedIn" | "unreachable";

interface AuthState {
  status: AuthStatus;
  user: User | null;
  session: Session | null;
  token: string | null;
  /** ISO time the current token stops working (Section 26: 8h) -- drives proactive refresh. */
  expiresAt: string | null;
  /** Set once hydrate() (or signIn) has resolved, so the root layout knows it's safe to render. */
  hasHydrated: boolean;
  hydrate: () => Promise<void>;
  signIn: (token: string, user: User, expiresAt: string) => Promise<void>;
  signOut: () => Promise<void>;
  setToken: (token: string, expiresAt?: string) => Promise<void>;
  setUser: (user: User, session?: Session) => void;
  /** Couldn't confirm the stored session this launch: run on the cached user if there is one. */
  markUnreachable: () => Promise<void>;
}

async function readCachedUser(): Promise<User | null> {
  try {
    const raw = await AsyncStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: User | null) {
  const op = user ? AsyncStorage.setItem(USER_KEY, JSON.stringify(user)) : AsyncStorage.removeItem(USER_KEY);
  // The cache is a convenience, never required.
  op.catch(() => undefined);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "hydrating",
  user: null,
  session: null,
  token: null,
  expiresAt: null,
  hasHydrated: false,

  hydrate: async () => {
    const token = await SecureStore.getItem(TOKEN_KEY);
    if (!token) {
      set({ status: "signedOut", hasHydrated: true });
      return;
    }
    const expiresAt = await SecureStore.getItem(EXPIRES_KEY);
    // Set the token immediately so the api-client's getToken() sees it for the /auth/me
    // call the caller (root layout) is about to make; status flips once that resolves.
    set({ token, expiresAt, hasHydrated: true, status: "hydrating" });
  },

  signIn: async (token, user, expiresAt) => {
    await SecureStore.setItem(TOKEN_KEY, token);
    await SecureStore.setItem(EXPIRES_KEY, expiresAt);
    writeCachedUser(user);
    set({ token, user, expiresAt, status: "signedIn" });
  },

  signOut: async () => {
    await SecureStore.deleteItem(TOKEN_KEY);
    await SecureStore.deleteItem(EXPIRES_KEY);
    writeCachedUser(null);
    set({ token: null, user: null, session: null, expiresAt: null, status: "signedOut" });
  },

  setToken: async (token, expiresAt) => {
    await SecureStore.setItem(TOKEN_KEY, token);
    if (expiresAt) await SecureStore.setItem(EXPIRES_KEY, expiresAt);
    set({ token, ...(expiresAt ? { expiresAt } : {}) });
  },

  setUser: (user, session) => {
    writeCachedUser(user);
    set({ user, session, status: "signedIn" });
  },

  markUnreachable: async () => {
    if (get().status !== "hydrating" && get().status !== "unreachable") return;
    const cached = await readCachedUser();
    if (cached) set({ user: cached, status: "signedIn" });
    else set({ status: "unreachable" });
  },
}));

export function getAuthState() {
  return useAuthStore.getState();
}
