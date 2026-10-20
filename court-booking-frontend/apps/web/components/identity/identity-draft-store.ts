"use client";

import { create } from "zustand";

/**
 * The CNIC typed in the wizard, kept IN MEMORY ONLY (no persist middleware, never localStorage/sessionStorage) until it
 * is submitted right after the venue is created. A reload loses it on purpose; the owner types it again.
 */
export interface IdentityDraft {
  number: string;
  front: File | null;
  back: File | null;
}

interface IdentityDraftState extends IdentityDraft {
  set: (patch: Partial<IdentityDraft>) => void;
  clear: () => void;
}

export const useIdentityDraftStore = create<IdentityDraftState>()((set) => ({
  number: "",
  front: null,
  back: null,
  set: (patch) => set(patch),
  clear: () => set({ number: "", front: null, back: null }),
}));
