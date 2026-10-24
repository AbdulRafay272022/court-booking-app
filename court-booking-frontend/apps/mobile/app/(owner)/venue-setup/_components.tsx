import { createContext, useContext } from "react";
import { View, type TextInputProps } from "react-native";
import { palette, radius, space } from "@court-booking/ui-tokens";
import { Button, Chip as FlChip, Input, StepBar, Text } from "@/components/ui";

/**
 * Wizard + Venue settings form kit (OWizard / OSettings boards), now a thin layer over the Floodlight library: SectionCard =
 * white card, TextField = DS Input (label always visible, role focus border), Chip = DS Chip (role tint + "✓"),
 * Primary/SecondaryButton = DS Button. Kept as a module so the many call sites (and their e2e labels) stay the same.
 *
 * Venue settings for a staff member without the right permission: inside a read-only fence every TextField stops being
 * editable, Chips stop toggling and Primary/Secondary buttons (the Saves) are not rendered. Outside a fence (the wizard,
 * owners) nothing changes.
 */
const ReadOnlyContext = createContext(false);

/** True inside a read-only fence (for parts that are neither TextFields nor Chips, e.g. a hint to hide). */
export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}

export function ReadOnlyFence({ readOnly, children }: { readOnly: boolean; children: React.ReactNode }) {
  if (!readOnly) return <>{children}</>;
  return (
    <ReadOnlyContext.Provider value>
      {/* pointerEvents also stops the pickers, toggles and links that are not TextFields or Chips */}
      <View pointerEvents="none" accessibilityState={{ disabled: true }} testID="read-only-fence" style={{ gap: space[4] }}>
        {children}
      </View>
    </ReadOnlyContext.Provider>
  );
}

export function SectionCard({ children, testID }: { children: React.ReactNode; testID?: string }) {
  return (
    <View testID={testID} style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[5], gap: space[5] }}>
      {children}
    </View>
  );
}

export function SectionLabel({ children }: { children: string }) {
  return (
    <Text variant="eyebrow" tone="muted" style={{ letterSpacing: 1.2 }}>
      {children.toUpperCase()}
    </Text>
  );
}

export function FieldLabel({ children }: { children: string }) {
  return <Text variant="label">{children}</Text>;
}

interface TextFieldProps extends Omit<TextInputProps, "style"> {
  label: string;
  /** Kept for old call sites: numbers are always tabular now, never monospace. */
  mono?: boolean;
  /** Inline validation error to render under the input (accepts null so callers can pass a validator's return value
   * directly). Red border + red line below, announced. */
  error?: string | null;
  style?: unknown;
}

export function TextField({ label, mono: _mono, style: _style, error, editable, ...props }: TextFieldProps) {
  const readOnly = useContext(ReadOnlyContext);
  return (
    <View style={{ flexGrow: 1, flexShrink: 1 }}>
      <Input label={label} error={error} editable={readOnly ? false : editable} {...props} />
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const readOnly = useContext(ReadOnlyContext);
  return <FlChip label={label} selected={selected} onPress={onPress} disabled={readOnly} />;
}

/** Smart submit: inert while `disabled` (the form isn't valid yet), the owner teal once it is. `loading` blocks a second
 * submit. Not rendered inside a read-only fence. */
export function PrimaryButton({ label, onPress, disabled, loading, testID }: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean; testID?: string }) {
  const readOnly = useContext(ReadOnlyContext);
  if (readOnly) return null;
  return <Button label={label} onPress={onPress} disabled={disabled} loading={loading} size="md" testID={testID} />;
}

export function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  const readOnly = useContext(ReadOnlyContext);
  if (readOnly) return null;
  return <Button label={label} onPress={onPress} variant="soft" size="md" />;
}

/** OWizard step bar: 1 Venue · 2 Courts · 3 Review (DS StepBar; done steps also carry a tick, never colour alone). */
export function WizardSteps({ current }: { current: 0 | 1 | 2 }) {
  return <StepBar tone="light" current={current} labels={["1 · Venue", "2 · Courts", "3 · Review"].map((l, i) => (i < current ? `✓ ${l}` : l))} />;
}
