import { createContext, useContext, useState } from "react";
import { Pressable, Text, TextInput, TextInputProps, View } from "react-native";
import { CheckIcon } from "@/components/icons";

/** Venue settings for a staff member without the right permission: inside a read-only fence every TextField stops
 * being editable, Chips stop toggling and Primary/Secondary buttons (the Saves) are not rendered. Outside a fence
 * (the wizard, owners) nothing changes. */
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
      <View pointerEvents="none" accessibilityState={{ disabled: true }} testID="read-only-fence" className="gap-4">
        {children}
      </View>
    </ReadOnlyContext.Provider>
  );
}

export function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <View className="bg-owner-surface border border-owner-border rounded-2xl p-6 gap-5">
      {children}
    </View>
  );
}

export function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="font-plex-semibold text-owner-ink-faint text-[11px] tracking-[1.2px]">
      {children.toUpperCase()}
    </Text>
  );
}

export function FieldLabel({ children }: { children: string }) {
  return <Text className="font-plex-semibold text-owner-ink-muted text-[13px]">{children}</Text>;
}

interface TextFieldProps extends TextInputProps {
  label: string;
  mono?: boolean;
  /** Inline validation error to render under the input (accepts null so callers can pass a
   * validator's return value directly without a ternary). Red border + red hint below. */
  error?: string | null;
}

export function TextField({ label, mono, style, error, ...props }: TextFieldProps) {
  const readOnly = useContext(ReadOnlyContext);
  const [focused, setFocused] = useState(false);
  const borderColor = error ? "#C13525" : focused ? "#0E6274" : "#DCE3E6";
  return (
    <View className="gap-2 flex-1">
      <FieldLabel>{label}</FieldLabel>
      <TextInput
        {...props}
        editable={readOnly ? false : props.editable}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        placeholderTextColor="#8399A1"
        className={mono ? "font-mono-medium" : "font-plex-medium"}
        style={[
          {
            height: 48,
            paddingHorizontal: 14,
            borderRadius: 9,
            backgroundColor: readOnly ? "#F4F6F7" : "#FFFFFF",
            borderWidth: focused || error ? 1.5 : 1,
            borderColor,
            fontSize: 15,
            color: "#101C21",
          },
          style,
        ]}
      />
      {error ? (
        <Text accessibilityRole="alert" className="font-plex-medium text-[12.5px]" style={{ color: "#C13525" }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const readOnly = useContext(ReadOnlyContext);
  return (
    <Pressable
      onPress={onPress}
      disabled={readOnly}
      className="min-h-11 px-4 rounded-lg flex-row items-center gap-1.5"
      style={{
        backgroundColor: selected ? "#0E6274" : "#FFFFFF",
        borderWidth: selected ? 0 : 1,
        borderColor: "#DCE3E6",
      }}
    >
      {selected ? <CheckIcon size={13} color="#FFFFFF" strokeWidth={2.8} /> : null}
      <Text
        className="font-plex-semibold text-sm"
        style={{ color: selected ? "#FFFFFF" : "#5B7079" }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Smart submit: muted grey and inert while `disabled` (the form isn't valid yet), the full owner
 * teal once it is. `loading` blocks a second submit. */
export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const readOnly = useContext(ReadOnlyContext);
  if (readOnly) return null;
  return (
    <Pressable
      onPress={() => {
        if (!disabled && !loading) onPress();
      }}
      disabled={disabled || loading}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      className="min-h-12 px-7 rounded-lg items-center justify-center"
      style={{ backgroundColor: disabled ? "#DCE3E6" : "#0E6274", opacity: loading ? 0.7 : 1 }}
    >
      <Text className="font-plex-semibold text-[14.5px]" style={{ color: disabled ? "#8399A1" : "#FFFFFF" }}>
        {loading ? "Saving…" : label}
      </Text>
    </Pressable>
  );
}

export function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  const readOnly = useContext(ReadOnlyContext);
  if (readOnly) return null;
  return (
    <Pressable
      onPress={onPress}
      className="min-h-12 px-6 rounded-lg border border-owner-border items-center justify-center"
    >
      <Text className="font-plex-semibold text-owner-ink-muted text-[14.5px]">{label}</Text>
    </Pressable>
  );
}
