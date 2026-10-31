"use client";

import { useQuery } from "@tanstack/react-query";
import { pointsReasonLabel } from "@court-booking/types";
import { api } from "@/lib/api";
import { useFmt } from "@/lib/use-fmt";
import { useLang, useT } from "@/components/i18n/lang-provider";
import { Card } from "./parts";

/** audit 2026-10-28 Phase 3 item 3: the player's points on their profile (balance, the rule, recent history). Hidden while the
 * player_points flag is off. */
export function PointsCard() {
  const t = useT();
  const lang = useLang();
  const fmt = useFmt();
  const q = useQuery({ queryKey: ["my-points"], queryFn: () => api.phase3.myPoints() });
  const d = q.data;
  if (!d || !d.enabled) return null;
  return (
    <Card className="flex flex-col gap-3" data-testid="points-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-khelo-display text-[20px] font-extrabold tracking-tight">{t("play.p3.pointsTitle")}</h2>
        <span className="font-mono text-[22px] font-extrabold" data-testid="points-balance">{d.balance}</span>
      </div>
      <p className="text-[13.5px] text-khelo-muted">{lang === "en" ? d.rule_text_en : d.rule_text_ru}</p>
      {d.entries.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {d.entries.slice(0, 6).map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 text-[14px]">
              <span>
                {pointsReasonLabel(e.reason, lang === "en" ? "en" : "ru")}
                {e.code ? <span className="text-khelo-muted"> · {e.code}</span> : null}
                <span className="text-khelo-muted"> · {fmt.relative(e.created_at)}</span>
              </span>
              <span className={`font-mono font-bold ${e.delta < 0 ? "text-red-700" : "text-green-700"}`}>{e.delta > 0 ? `+${e.delta}` : e.delta}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
