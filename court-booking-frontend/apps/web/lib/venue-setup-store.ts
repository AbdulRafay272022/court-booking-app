"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface CourtDraft {
  name: string;
  sport: string;
  slotMinutes: number;
  // Section 31: cancellation policy is per court (the backend has always stored it per court;
  // the wizard used to apply one shared setting to every court it created).
  cancellationAllowed: boolean;
  /** Empty string = no cutoff (cancellable any time before start). */
  cancellationCutoffHours: string;
}

export interface PricingRuleDraft {
  id: string;
  name: string;
  pricePerSlot: string;
  dayOfWeek: number[] | null;
  startTime: string | null;
  endTime: string | null;
}

export interface DayOverride {
  open: string;
  close: string;
}

export const SPORT_OPTIONS = ["Padel", "Futsal", "Tennis", "Cricket", "Badminton"];
export const SLOT_MINUTES_OPTIONS = [60, 90, 120];
export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function makeCourt(index: number): CourtDraft {
  return { name: `Court ${index}`, sport: "Padel", slotMinutes: 90, cancellationAllowed: true, cancellationCutoffHours: "" };
}

function makeRule(name: string): PricingRuleDraft {
  return {
    id: Math.random().toString(36).slice(2),
    name,
    pricePerSlot: "",
    dayOfWeek: null,
    startTime: null,
    endTime: null,
  };
}

interface VenueSetupState {
  step: 1 | 2;
  // Step 1 — venue basics
  name: string;
  address: string;
  city: string;
  area: string;
  latitude: number | null;
  longitude: number | null;
  whatsapp: string;
  sports: string[];
  bankName: string;
  accountTitle: string;
  accountNumber: string;
  // Step 2 — courts, hours, pricing
  courts: CourtDraft[];
  sameHoursEveryDay: boolean;
  defaultOpenTime: string;
  defaultCloseTime: string;
  perDayOverrides: Partial<Record<number, DayOverride>>;
  pricingRules: PricingRuleDraft[];
  /** Set once POST /venues succeeds, so a retry after a partial submit failure
   * (e.g. court creation failing) doesn't create a second duplicate venue. */
  createdVenueId: string | null;
  /** Court-array index -> already-created court id (the same idempotency pattern as
   * createdVenueId above, one level down). `POST /courts` always inserts a new row, so
   * without this, a retry after ANY later step fails (or the client just never sees a
   * response the server already committed -- a real, observed failure mode, not just a
   * hypothetical) re-creates every court from scratch, duplicating the ones that already
   * succeeded. setSchedule/setPricing are safe to re-run unconditionally (the backend
   * replaces, not appends), so only court creation itself needs this guard. */
  createdCourtIds: Record<number, string>;

  setField: <K extends keyof VenueSetupState>(key: K, value: VenueSetupState[K]) => void;
  toggleSport: (sport: string) => void;
  addCourt: () => void;
  updateCourt: (index: number, patch: Partial<CourtDraft>) => void;
  removeCourt: (index: number) => void;
  setCreatedCourtId: (index: number, courtId: string) => void;
  setDayOverride: (day: number, override: DayOverride) => void;
  addPricingRule: () => void;
  updatePricingRule: (id: string, patch: Partial<PricingRuleDraft>) => void;
  removePricingRule: (id: string) => void;
  reset: () => void;
}

const initialState = {
  step: 1 as const,
  name: "",
  address: "",
  city: "Karachi",
  area: "",
  latitude: null as number | null,
  longitude: null as number | null,
  whatsapp: "",
  sports: [] as string[],
  bankName: "",
  accountTitle: "",
  accountNumber: "",
  courts: [makeCourt(1)],
  sameHoursEveryDay: true,
  defaultOpenTime: "06:00",
  defaultCloseTime: "23:00",
  perDayOverrides: {} as Partial<Record<number, DayOverride>>,
  pricingRules: [makeRule("All day")],
  createdVenueId: null as string | null,
  createdCourtIds: {} as Record<number, string>,
};

export const useVenueSetupStore = create<VenueSetupState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setField: (key, value) => set({ [key]: value } as never),

      toggleSport: (sport) => {
        const current = get().sports;
        set({
          sports: current.includes(sport)
            ? current.filter((s) => s !== sport)
            : [...current, sport],
        });
      },

      // Editing the court list after a failed/partial submit attempt invalidates the
      // index -> created-court-id correlation below, so each of these clears it -- safer
      // to redo a cheap idempotent step than to risk a stale index pointing at the wrong
      // court after a reorder/removal.
      addCourt: () => set({ courts: [...get().courts, makeCourt(get().courts.length + 1)], createdCourtIds: {} }),

      updateCourt: (index, patch) => {
        const courts = [...get().courts];
        courts[index] = { ...courts[index], ...patch };
        set({ courts, createdCourtIds: {} });
      },

      removeCourt: (index) => {
        const courts = get().courts.filter((_, i) => i !== index);
        set({ courts: courts.length > 0 ? courts : [makeCourt(1)], createdCourtIds: {} });
      },

      setCreatedCourtId: (index, courtId) => {
        set({ createdCourtIds: { ...get().createdCourtIds, [index]: courtId } });
      },

      setDayOverride: (day, override) => {
        set({ perDayOverrides: { ...get().perDayOverrides, [day]: override } });
      },

      addPricingRule: () =>
        set({ pricingRules: [...get().pricingRules, makeRule("Peak hours")] }),

      updatePricingRule: (id, patch) => {
        set({
          pricingRules: get().pricingRules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        });
      },

      removePricingRule: (id) => {
        const rules = get().pricingRules.filter((r) => r.id !== id);
        set({ pricingRules: rules.length > 0 ? rules : [makeRule("All day")] });
      },

      reset: () => set(initialState),
    }),
    {
      name: "maidan.venue-setup-draft",
      version: 2,
      // v1 drafts kept ONE shared cancellation setting on the draft itself; carry it onto every
      // court so an owner mid-wizard keeps what they'd already chosen (and no court is left
      // without the per-court fields, which would render as an undefined chip state).
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        if (version < 2) {
          const allowed = typeof state.cancellationAllowed === "boolean" ? state.cancellationAllowed : true;
          const cutoff = typeof state.cancellationCutoffHours === "string" ? state.cancellationCutoffHours : "";
          const courts = Array.isArray(state.courts) ? (state.courts as Partial<CourtDraft>[]) : [];
          state.courts = courts.map((c) => ({
            ...c,
            cancellationAllowed: c.cancellationAllowed ?? allowed,
            cancellationCutoffHours: c.cancellationCutoffHours ?? cutoff,
          }));
          delete state.cancellationAllowed;
          delete state.cancellationCutoffHours;
        }
        return state as unknown as VenueSetupState;
      },
      storage: createJSONStorage(() => window.localStorage),
    },
  ),
);
