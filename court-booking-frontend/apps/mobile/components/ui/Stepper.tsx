import { View } from "react-native";
import { Minus, Plus } from "lucide-react-native";
import { palette, radius, space } from "@court-booking/ui-tokens";
import { IconButton } from "./IconButton";
import { Text } from "./Text";
import { useCopy } from "./theme";

export interface StepperProps {
  /** Field name, always visible ("Hold ka waqt"). */
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Unit after the number ("min"). */
  unit?: string;
  /** Help line ("Default: 15 min"). */
  help?: string;
  testID?: string;
}

/** − value + stepper (OSettings Timers). 44pt buttons, value in Bricolage, announced as an adjustable control. */
export function Stepper({ label, value, onChange, min, max, step = 1, unit, help, testID }: StepperProps) {
  const copy = useCopy();
  const dec = () => onChange(Math.max(min, value - step));
  const inc = () => onChange(Math.min(max, value + step));
  const text = `${value}${unit ? ` ${unit}` : ""}`;
  return (
    <View testID={testID} style={{ gap: space[2] }}>
      <Text variant="label">{label}</Text>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: value, text }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => (e.nativeEvent.actionName === "increment" ? inc() : dec())}
        style={{ flexDirection: "row", alignItems: "center", gap: space[3], backgroundColor: palette.ground, borderRadius: radius.input, padding: 6, alignSelf: "flex-start" }}
      >
        <IconButton icon={Minus} variant="surface" accessibilityLabel={copy(`${label} kam karein`, `Decrease ${label}`)} onPress={dec} disabled={value <= min} testID={testID ? `${testID}-dec` : undefined} />
        <Text variant="title" align="center" style={{ minWidth: 72 }}>
          {text}
        </Text>
        <IconButton icon={Plus} variant="surface" accessibilityLabel={copy(`${label} barhayein`, `Increase ${label}`)} onPress={inc} disabled={value >= max} testID={testID ? `${testID}-inc` : undefined} />
      </View>
      {help ? (
        <Text variant="caption" tone="muted">
          {help}
        </Text>
      ) : null}
    </View>
  );
}
