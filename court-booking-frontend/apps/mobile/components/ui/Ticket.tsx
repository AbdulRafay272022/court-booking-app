import type { ReactNode } from "react";
import { View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { isConfirmed, palette, radius, shadow, space, type StatusInput } from "@court-booking/ui-tokens";
import { StatusPill } from "./StatusPill";
import { Text } from "./Text";
import { useCopy } from "./theme";

export interface TicketField {
  label: string;
  value: string;
}

export interface TicketProps {
  /** booking.id: the owner scanner reads the booking UUID (docs/floodlight-contract.md "Ticket QR"). */
  bookingId: string;
  /** Real booking status fields. The QR is shown ONLY when status === "booked". */
  booking: StatusInput;
  venueName: string;
  /** "PADEL · COURT 1". */
  eyebrow?: string;
  /** Din / Waqt / Total / Baqi... rendered in a 2-column grid (wraps, never truncated). */
  fields: TicketField[];
  /** Under the QR. Defaults to "Gate par ye dikhayein". */
  qrTitle?: string;
  qrBody?: string;
  /** Extra content under the stub (e.g. checked-in note). */
  footer?: ReactNode;
  /** Page background colour behind the ticket (for the punched notches). Default ground. */
  pageColor?: string;
  testID?: string;
}

/** Status board booked ticket: header, fields, dashed tear line with notches, QR (react-native-qrcode-svg). */
export function Ticket({ bookingId, booking, venueName, eyebrow, fields, qrTitle, qrBody, footer, pageColor = palette.ground, testID }: TicketProps) {
  const copy = useCopy();
  const ok = isConfirmed(booking.status);
  return (
    <View testID={testID ?? "ticket"} style={{ backgroundColor: palette.white, borderRadius: radius.cardL, boxShadow: shadow.ticket, overflow: "hidden" }}>
      <View style={{ padding: space[5], gap: 14 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <View style={{ flex: 1, minWidth: 160, gap: 2 }}>
            {eyebrow ? (
              <Text variant="eyebrow" tone="subtle">
                {eyebrow}
              </Text>
            ) : null}
            <Text variant="h3">{venueName}</Text>
          </View>
          <StatusPill booking={booking} />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: space[3] }}>
          {fields.map((f) => (
            <View key={f.label} style={{ width: "50%", paddingRight: space[2], gap: 2 }}>
              <Text variant="caption" weight="bold" tone="subtle">
                {f.label}
              </Text>
              <Text variant="bodyStrong">{f.value}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={{ height: 22, justifyContent: "center" }} accessibilityElementsHidden importantForAccessibility="no">
        <View style={{ position: "absolute", left: -11, width: 22, height: 22, borderRadius: 11, backgroundColor: pageColor }} />
        <View style={{ marginHorizontal: 18, borderTopWidth: 2, borderStyle: "dashed", borderColor: palette.line }} />
        <View style={{ position: "absolute", right: -11, width: 22, height: 22, borderRadius: 11, backgroundColor: pageColor }} />
      </View>
      <View style={{ padding: space[5], paddingTop: space[4], flexDirection: "row", alignItems: "center", gap: space[4], flexWrap: "wrap" }}>
        {ok ? (
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={copy("Check-in QR code", "Check-in QR code")}
            style={{ padding: 6, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, backgroundColor: palette.white }}
          >
            <QRCode value={bookingId} size={100} color={palette.night} backgroundColor={palette.white} ecl="M" />
          </View>
        ) : null}
        <View style={{ flex: 1, minWidth: 150, gap: 4 }}>
          <Text variant="bodyStrong">{ok ? qrTitle ?? copy("Gate par ye dikhayein", "Show this at the gate") : copy("QR pakki booking par milega", "QR appears once booked")}</Text>
          <Text variant="meta" tone="muted">
            {ok
              ? qrBody ?? copy("Venue scan karega aur aap ka check-in ho jayega.", "The venue scans it to check you in.")
              : copy("Venue ke approve karte hi yahan QR aa jayega.", "The QR shows here as soon as the venue approves.")}
          </Text>
        </View>
      </View>
      {footer ? <View style={{ paddingHorizontal: space[5], paddingBottom: space[5] }}>{footer}</View> : null}
    </View>
  );
}
