import { View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { palette, radius, space } from "@court-booking/ui-tokens";
import { Text } from "@/components/ui";

/** audit 2026-10-28 item 20: the Raast QR (account + amount filled in) under the bank details; only when the `iban_qr` flag
 * is on and the venue saved a valid IBAN (the server decides). Needs device: scan with Meezan, HBL, Easypaisa, JazzCash. */
export function RaastQr({ payload }: { payload: string }) {
  return (
    <View style={{ alignItems: "center", gap: space[2], paddingTop: space[2] }} testID="raast-qr">
      <View style={{ padding: space[3], backgroundColor: palette.white, borderRadius: radius.tile }}>
        <QRCode value={payload} size={196} color={palette.night} backgroundColor={palette.white} />
      </View>
      <Text variant="meta" tone="muted" align="center">
        Apni bank ya wallet app se ye QR scan karein: account aur raqam khud bhar jayegi. Phir screenshot bhejna na bhoolein.
      </Text>
    </View>
  );
}
