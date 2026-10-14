// Roman Urdu copy (source of truth for ru). Keys start with 'odash.'. One file per sub-area, merged here.
import { ruOdashShell } from "./odash-shell";
import { ruOdashToday } from "./odash-today";
import { ruOdashOps } from "./odash-ops";
import { ruOdashMoney } from "./odash-money";
import { ruOdashAdmin } from "./odash-admin";

export const ruOdash = {
  ...ruOdashShell,
  ...ruOdashToday,
  ...ruOdashOps,
  ...ruOdashMoney,
  ...ruOdashAdmin,
} as const;
