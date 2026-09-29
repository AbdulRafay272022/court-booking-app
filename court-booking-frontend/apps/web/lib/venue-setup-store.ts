"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  DAY_LABELS,
  SLOT_MINUTES_OPTIONS,
  SPORT_OPTIONS,
  cloneCourtSetup,
  defaultCourtSetup,
  makePricingRule,
  type CourtSetup,
} from "@court-booking/types";

// Re-exported so existing imports keep working. The week is Monday-first, matching the backend (see court-setup.ts).
export { DAY_LABELS, SLOT_MINUTES_OPTIONS, SPORT_OPTIONS };

/** One court in the wizard: its name and sport plus ITS OWN slot length, hours and prices (Section 32 Part 4: these
 * used to be one shared set for every court the wizard created). */
export interface CourtDraft extends CourtSetup {
  name: string;
  sport: string;
  /** Indoor court? Old drafts have no value (treated as outdoor). */
  isIndoor?: boolean;
}

function makeCourt(index: number, from?: CourtDraft): CourtDraft {
  // A new court starts as a copy of the previous one (same sport, slot length, hours and prices) because most venues'
  // courts are alike; it is a starting point the owner edits, and every court's card shows its own values.
  const base: CourtSetup = from ? cloneCourtSetup(from) : defaultCourtSetup();
  return { ...base, name: `Court ${index}`, sport: from?.sport ?? "Padel", isIndoor: from?.isIndoor ?? false };
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
  /** Venue amenity keys (AMENITY_OPTIONS). Old drafts have none. */
  amenities: string[];
  bankName: string;
  accountTitle: string;
  accountNumber: string;
  /** Section 32 Part 4: ONE cancellation policy per venue. Empty cutoff string = no cutoff. */
  cancellationAllowed: boolean;
  cancellationCutoffHours: string;
  // Step 2 — courts (each with its own slot length, hours and prices)
  courts: CourtDraft[];
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
  /** Courts that were already created on the server when the owner deleted their tab; deactivated on the next submit
   * so a delete after a partial failure doesn't leave an orphan court behind. */
  orphanCourtIds: string[];

  setField: <K extends keyof VenueSetupState>(key: K, value: VenueSetupState[K]) => void;
  toggleSport: (sport: string) => void;
  toggleAmenity: (key: string) => void;
  addCourt: () => void;
  updateCourt: (index: number, patch: Partial<CourtDraft>) => void;
  removeCourt: (index: number) => void;
  setCreatedCourtId: (index: number, courtId: string) => void;
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
  amenities: [] as string[],
  bankName: "",
  accountTitle: "",
  accountNumber: "",
  cancellationAllowed: true,
  cancellationCutoffHours: "",
  courts: [makeCourt(1)],
  createdVenueId: null as string | null,
  createdCourtIds: {} as Record<number, string>,
  orphanCourtIds: [] as string[],
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

      toggleAmenity: (key) => {
        const current = get().amenities ?? [];
        set({ amenities: current.includes(key) ? current.filter((k) => k !== key) : [...current, key] });
      },

      // createdCourtIds maps a court's array index to the court already created on the server for it. Appending a
      // court or editing one in place doesn't move any index, so the map stays valid (the submit PATCHes an
      // already-created court instead of re-creating it, so an edit after a partial failure can't duplicate courts).
      // Removing a tab DOES shift every later index, so the map is re-keyed, and a removed court that already exists
      // on the server is queued in orphanCourtIds to be deactivated on the next submit.
      addCourt: () => {
        const courts = get().courts;
        set({ courts: [...courts, makeCourt(courts.length + 1, courts[courts.length - 1])] });
      },

      updateCourt: (index, patch) => {
        const courts = [...get().courts];
        courts[index] = { ...courts[index], ...patch };
        set({ courts });
      },

      removeCourt: (index) => {
        const courts = get().courts.filter((_, i) => i !== index);
        const ids = get().createdCourtIds;
        const shifted: Record<number, string> = {};
        for (const [k, id] of Object.entries(ids)) {
          const i = Number(k);
          if (i < index) shifted[i] = id;
          else if (i > index) shifted[i - 1] = id;
        }
        const removedId = ids[index];
        set({
          courts: courts.length > 0 ? courts : [makeCourt(1)],
          createdCourtIds: courts.length > 0 ? shifted : {},
          orphanCourtIds: [...(get().orphanCourtIds ?? []), ...(removedId ? [removedId] : [])],
        });
      },

      setCreatedCourtId: (index, courtId) => {
        set({ createdCourtIds: { ...get().createdCourtIds, [index]: courtId } });
      },

      reset: () => set(initialState),
    }),
    {
      name: "maidan.venue-setup-draft",
      version: 4,
      // v1 kept ONE shared cancellation setting on the draft; v2 moved it onto each court (Section 31). v3 (Section 32
      // Part 4) makes it ONE per venue again and gives every court its OWN hours and prices instead of one shared set.
      // An owner who is mid-wizard keeps everything they had typed: the shared hours/prices are copied onto each
      // court, and the venue takes the most player-friendly cancellation policy across their courts.
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        if (version < 2) {
          const allowed = typeof state.cancellationAllowed === "boolean" ? state.cancellationAllowed : true;
          const cutoff = typeof state.cancellationCutoffHours === "string" ? state.cancellationCutoffHours : "";
          const courts = Array.isArray(state.courts) ? (state.courts as Record<string, unknown>[]) : [];
          state.courts = courts.map((c) => ({
            ...c,
            cancellationAllowed: c.cancellationAllowed ?? allowed,
            cancellationCutoffHours: c.cancellationCutoffHours ?? cutoff,
          }));
          delete state.cancellationAllowed;
          delete state.cancellationCutoffHours;
        }
        if (version < 3) {
          const oldCourts = Array.isArray(state.courts) ? (state.courts as Record<string, unknown>[]) : [];
          const fallback = defaultCourtSetup();
          // The old screens numbered the week Sunday-first (Sun = 0); the API and the new screens use Monday = 0.
          const oldOverrides = (state.perDayOverrides ?? {}) as Record<string, { open: string; close: string }>;
          const overrides: CourtSetup["perDayOverrides"] = {};
          for (const [day, o] of Object.entries(oldOverrides)) overrides[(Number(day) + 6) % 7] = o;
          const shared: Omit<CourtSetup, "slotMinutes"> = {
            sameHoursEveryDay: typeof state.sameHoursEveryDay === "boolean" ? state.sameHoursEveryDay : true,
            openTime: typeof state.defaultOpenTime === "string" ? state.defaultOpenTime : fallback.openTime,
            closeTime: typeof state.defaultCloseTime === "string" ? state.defaultCloseTime : fallback.closeTime,
            perDayOverrides: overrides,
            pricingRules: Array.isArray(state.pricingRules) && state.pricingRules.length > 0
              ? (state.pricingRules as CourtSetup["pricingRules"])
              : [makePricingRule("All day")],
          };
          const allowing = oldCourts.filter((c) => c.cancellationAllowed !== false);
          state.cancellationAllowed = oldCourts.length === 0 || allowing.length > 0;
          const cutoffs = allowing.map((c) => String(c.cancellationCutoffHours ?? "")).filter((h) => h !== "");
          state.cancellationCutoffHours = allowing.some((c) => !String(c.cancellationCutoffHours ?? "")) || cutoffs.length === 0
            ? ""
            : String(Math.min(...cutoffs.map(Number)));
          state.courts = oldCourts.map((c) => {
            const own = cloneCourtSetup({ ...shared, slotMinutes: Number(c.slotMinutes) || fallback.slotMinutes });
            return { ...own, name: String(c.name ?? ""), sport: String(c.sport ?? "Padel") };
          });
          for (const key of ["sameHoursEveryDay", "defaultOpenTime", "defaultCloseTime", "perDayOverrides", "pricingRules"]) delete state[key];
        }
        if (version < 4) {
          // v4: venue amenities + per-court indoor flag + the orphan-court queue. Old drafts simply get the defaults.
          if (!Array.isArray(state.amenities)) state.amenities = [];
          if (!Array.isArray(state.orphanCourtIds)) state.orphanCourtIds = [];
        }
        return state as unknown as VenueSetupState;
      },
      storage: createJSONStorage(() => window.localStorage),
    },
  ),
);
