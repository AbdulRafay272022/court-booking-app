import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { palette, radius, shadow, space } from "@court-booking/ui-tokens";
import type { OwnerBookingRow } from "@court-booking/types";
import { Text, useRoleTheme } from "@/components/ui";

import { formatPKR, formatTime, formatTimeRange } from "@/lib/format";
import { spanLabel, timelineModel, type TimelineBlock, type TimelineGap, type TimelineKind } from "@/lib/owner-floodlight";

/** px per hour: a 30-minute booking is 48 tall, so every block is a >= 44 pt target. */
const PX_HOUR = 96;
const LABEL_W = 52;
const MIN_COL = 116;

const KIND_LABEL: Record<TimelineKind, string> = { booked: "Booked", walkin: "Walk-in", pending: "Check baqi", noshow: "No-show" };

function blockLook(kind: TimelineKind) {
  switch (kind) {
    case "booked":
      return { bg: palette.teal, fg: palette.white, border: palette.teal, dashed: false };
    case "walkin":
      return { bg: palette.tealTint, fg: palette.night, border: palette.tealTint, dashed: false };
    case "pending":
      return { bg: palette.waitingTint, fg: palette.waiting, border: palette.amber, dashed: false };
    case "noshow":
      return { bg: palette.mist, fg: palette.body, border: palette.lineStrong, dashed: true };
  }
}

function hourLabel(ms: number): string {
  return formatTime(new Date(ms).toISOString()).replace(":00", "");
}

function blockMeta(b: TimelineBlock): string {
  const r = b.row;
  if (b.kind === "pending") return "Check baqi";
  if (b.kind === "noshow") return "No-show";
  const money = r.due > 0 ? `PKR ${formatPKR(r.due)} venue par` : "Paid";
  return b.kind === "walkin" ? `Walk-in · ${money}` : money;
}

/**
 * OwnerToday "Courts ka din": one column per court, bookings as blocks on an hour grid, gaps (no booking) as dashed
 * "+ Add" (walk-in, only ahead of now and with the walkin permission), the orange "now" line (the one other orange accent
 * on the owner side). Built from the SAME overview rows as the list under it. Many courts scroll sideways inside the card.
 */
export function CourtsTimeline({
  rows,
  courts,
  operatingDay,
  nowMs,
  onOpen,
  onAdd,
}: {
  rows: OwnerBookingRow[];
  courts: { id: string; name: string }[];
  operatingDay: { start_at: string; end_at: string } | null;
  nowMs: number;
  onOpen: (bookingId: string) => void;
  /** Present only when this account may add a walk-in. */
  onAdd?: (courtId: string, startsAt: string) => void;
}) {
  const t = useRoleTheme();
  const [wholeDay, setWholeDay] = useState(false);
  // Today opens an hour before "now" (a toggle shows the earlier hours); another day shows the whole day.
  const clip = wholeDay ? null : nowMs - 3600_000;
  const model = useMemo(() => timelineModel(rows, courts, operatingDay, nowMs, 30, clip), [rows, courts, operatingDay, nowMs, clip]);
  if (!model) return null;
  const height = (model.minutes / 60) * PX_HOUR;
  const y = (min: number) => (min / 60) * PX_HOUR;
  const cols = model.columns;
  const grid = (
    <View style={{ flexDirection: "row", gap: space[2], minWidth: LABEL_W + cols.length * (MIN_COL + space[2]) }}>
      <View style={{ width: LABEL_W, height }}>
        {model.hours.map((h, i) => (
          <Text key={h.ms} variant="caption" weight="bold" tone="muted" align="right" style={{ position: "absolute", right: space[2], top: i === 0 ? 0 : y(h.offset) - 8 }}>
            {hourLabel(h.ms)}
          </Text>
        ))}
      </View>
      {cols.map((c) => (
        <View key={c.courtId} style={{ flex: 1, minWidth: MIN_COL, height }}>
          {model.hours.map((h) => (
            <View key={h.ms} style={{ position: "absolute", left: 0, right: 0, top: y(h.offset), height: 1, backgroundColor: palette.ground }} />
          ))}
          {c.gaps.map((g) => (
            <Gap key={`g-${g.start}`} gap={g} top={y(g.start) + 2} h={y(g.end - g.start) - 4} onAdd={onAdd && g.future ? () => onAdd(c.courtId, new Date(Math.max(g.startMs, Math.ceil(nowMs / 1800_000) * 1800_000)).toISOString()) : undefined} />
          ))}
          {c.blocks.map((b) => {
            const look = blockLook(b.kind);
            const h = y(b.end - b.start) - 4;
            return (
              <Pressable
                key={b.row.booking_id}
                testID={`tl-block-${b.row.booking_id}`}
                onPress={() => onOpen(b.row.booking_id)}
                accessibilityRole="button"
                accessibilityLabel={`${b.row.player_name ?? "Player"}, ${c.name}, ${formatTimeRange(b.row.starts_at, b.row.ends_at)}, ${KIND_LABEL[b.kind]}, ${blockMeta(b)}`}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: y(b.start) + 2,
                  height: h,
                  borderRadius: radius.sm,
                  paddingHorizontal: space[2],
                  paddingVertical: 6,
                  backgroundColor: look.bg,
                  borderWidth: b.kind === "pending" || b.kind === "noshow" ? 1 : 0,
                  borderColor: look.border,
                  borderStyle: look.dashed ? "dashed" : "solid",
                  overflow: "hidden",
                  gap: 2,
                }}
              >
                <Text variant="label" color={look.fg} strike={b.kind === "noshow"}>
                  {b.row.player_name ?? "Player"}
                </Text>
                {h >= 70 ? (
                  <Text variant="caption" color={look.fg}>
                    {blockMeta(b)}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ))}
      {model.now !== null ? (
        <View pointerEvents="none" style={{ position: "absolute", left: LABEL_W - 8, right: 0, top: y(model.now) - 9, flexDirection: "row", alignItems: "center" }} accessibilityLabel={`Abhi ${formatTime(new Date(nowMs).toISOString())}`}>
          <View style={{ backgroundColor: t.nowLine, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 }}>
            <Text variant="tab" color={palette.night}>
              {formatTime(new Date(nowMs).toISOString()).replace(/ (AM|PM)$/, "")}
            </Text>
          </View>
          <View style={{ flex: 1, height: 2, backgroundColor: t.nowLine }} />
        </View>
      ) : null}
    </View>
  );
  return (
    <View testID="courts-timeline" style={{ backgroundColor: palette.white, borderRadius: 26, paddingTop: space[3], paddingBottom: 14, paddingRight: 10, boxShadow: shadow.card }}>
      {model.hiddenHours > 0 || wholeDay ? (
        <Pressable
          onPress={() => setWholeDay((w) => !w)}
          accessibilityRole="button"
          testID="timeline-toggle"
          style={{ minHeight: 44, justifyContent: "center", paddingLeft: 14, marginTop: -space[1] }}
        >
          <Text variant="label" tone="link" style={{ textDecorationLine: "underline" }}>
            {wholeDay ? "Sirf ab se aage dikhao" : `Pehle ke ${model.hiddenHours} ghante bhi dikhao`}
          </Text>
        </Pressable>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={cols.length > 2} scrollEnabled={cols.length > 2} contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ flex: 1, gap: space[2] }}>
          <View style={{ flexDirection: "row", gap: space[2], minWidth: LABEL_W + cols.length * (MIN_COL + space[2]) }}>
            <View style={{ width: LABEL_W }} />
            {cols.map((c) => (
              <Text key={c.courtId} variant="label" align="center" style={{ flex: 1, minWidth: MIN_COL }}>
                {c.name}
              </Text>
            ))}
          </View>
          {grid}
        </View>
      </ScrollView>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3], paddingTop: space[3], paddingLeft: 14 }}>
        <Legend label="Booked" bg={palette.teal} />
        <Legend label="Check baqi" bg={palette.waitingTint} border={palette.amber} />
        <Legend label="Walk-in" bg={palette.tealTint} />
        <Legend label="Koi booking nahi" bg={palette.white} border={palette.muted2} dashed />
      </View>
    </View>
  );
}

function Legend({ label, bg, border, dashed }: { label: string; bg: string; border?: string; dashed?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: bg, borderWidth: border ? 1 : 0, borderColor: border, borderStyle: dashed ? "dashed" : "solid" }} />
      <Text variant="caption" tone="body">
        {label}
      </Text>
    </View>
  );
}

function Gap({ gap, top, h, onAdd }: { gap: TimelineGap; top: number; h: number; onAdd?: () => void }) {
  const mins = gap.end - gap.start;
  const style = { position: "absolute" as const, left: 0, right: 0, top, height: h, borderRadius: radius.sm, borderWidth: 1, borderStyle: "dashed" as const, borderColor: palette.muted2, alignItems: "center" as const, justifyContent: "center" as const, paddingHorizontal: 4 };
  if (!onAdd) return gap.future ? <View style={[style, { opacity: 0.55 }]} accessibilityElementsHidden importantForAccessibility="no" /> : null;
  return (
    <Pressable onPress={onAdd} accessibilityRole="button" accessibilityLabel={`Walk-in add karein, ${spanLabel(mins)} mein koi booking nahi`} style={style}>
      <Text variant="label" tone="body" align="center">
        + Add
      </Text>
      {h >= 70 ? (
        <Text variant="caption" tone="muted" align="center">
          {`${spanLabel(mins)} koi booking nahi`}
        </Text>
      ) : null}
    </Pressable>
  );
}
