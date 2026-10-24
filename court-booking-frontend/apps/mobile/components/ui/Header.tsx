import type { ReactNode } from "react";
import { View } from "react-native";
import { ArrowLeft } from "lucide-react-native";
import { space } from "@court-booking/ui-tokens";
import { IconButton } from "./IconButton";
import { Text } from "./Text";
import { useCopy } from "./theme";

export interface HeaderProps {
  title: string;
  /** Small line above the title (e.g. "Padel · Aaj raat · DHA"). */
  eyebrow?: string;
  subtitle?: string;
  /** Back button handler. Omit for tab roots. */
  onBack?: () => void;
  backLabel?: string;
  /** Right-side actions (IconButtons). */
  right?: ReactNode;
  /** "light" on ground (default), "dark" on a night/teal hero (white text, glass back button). */
  tone?: "light" | "dark";
  /** "large" = Bricolage h2 page title (default), "compact" = centered 18pt bar title (Pay board). */
  size?: "large" | "compact";
  testID?: string;
}

/** Screen header: 44pt back button, title that wraps (never truncated), optional right actions. */
export function Header({ title, eyebrow, subtitle, onBack, backLabel, right, tone = "light", size = "large", testID }: HeaderProps) {
  const copy = useCopy();
  const dark = tone === "dark";
  const back = onBack ? (
    <IconButton icon={ArrowLeft} variant={dark ? "onDark" : "surface"} accessibilityLabel={backLabel ?? copy("Wapas", "Back")} onPress={onBack} testID={testID ? `${testID}-back` : "header-back"} />
  ) : null;
  if (size === "compact") {
    return (
      <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
        {back ?? <View style={{ width: 44 }} />}
        <Text variant="cta" tone={dark ? "onDark" : "primary"} align="center" accessibilityRole="header" style={{ flex: 1 }}>
          {title}
        </Text>
        {right ?? <View style={{ width: 44 }} />}
      </View>
    );
  }
  return (
    <View testID={testID} style={{ gap: space[2] }}>
      {back || right ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3] }}>
          {back ?? <View />}
          <View style={{ flexDirection: "row", gap: space[2] }}>{right}</View>
        </View>
      ) : null}
      {eyebrow ? (
        <Text variant="label" weight="bold" tone={dark ? "onDarkMuted" : "muted"}>
          {eyebrow}
        </Text>
      ) : null}
      <Text variant="h2" tone={dark ? "onDark" : "primary"} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? (
        <Text variant="body" tone={dark ? "onDarkMuted" : "muted"}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
