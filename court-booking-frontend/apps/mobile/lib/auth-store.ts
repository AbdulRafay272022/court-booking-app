import { create } from "zustand";
import * as SecureStore from "./secure-storage";
import type { Session, User } from "@court-booking/types";

const TOKEN_KEY = "maidan.session_token";

export type AuthStatus = "hydrating" | "signedOut" | "signedIn";

interface AuthState {
  status: AuthStatus;
  user: User | null;
  session: Session | null;
  token: string | null;
  /** Set once hydrate() (or signIn) has resolved, so the root layout knows it's safe to render. */
  hasHydrated: boolean;
  hydrate: () => Promise<void>;
  signIn: (token: string, user: User) => Promise<void>;
  signOut: () => Promise<void>;
  setToken: (token: string) => Promise<void>;
  setUser: (user: User, session?: Session) => void;
  /** Session couldn't be verified this launch (e.g. offline) — show login without discarding the token. */
  markUnverified: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "hydrating",
  user: null,
  session: null,
  token: null,
  hasHydrated: false,

  hydrate: async () => {
    const token = await SecureStore.getItem(TOKEN_KEY);
    if (!token) {
      set({ status: "signedOut", hasHydrated: true });
      return;
    }
    // Set the token immediately so the api-client's getToken() sees it for the /auth/me
    // call the caller (root layout) is about to make; status flips to signedIn/signedOut
    // once that call resolves.
    set({ token, hasHydrated: true });
  },

  signIn: async (token: string, user: User) => {
    await SecureStore.setItem(TOKEN_KEY, token);
    set({ token, user, status: "signedIn" });
  },

  signOut: async () => {
    await SecureStore.deleteItem(TOKEN_KEY);
    set({ token: null, user: null, session: null, status: "signedOut" });
  },

  setToken: async (token: string) => {
    await SecureStore.setItem(TOKEN_KEY, token);
    set({ token });
  },

  setUser: (user: User, session?: Session) => {
    set({ user, session, status: "signedIn" });
  },

  markUnverified: () => {
    if (get().status === "hydrating") set({ status: "signedOut" });
  },
}));

export function getAuthState() {
  return useAuthStore.getState();
}
