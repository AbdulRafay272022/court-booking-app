import { useState } from "react";
import { Pressable, Text, TextInput, TextInputProps, View } from "react-native";
import { CheckIcon } from "@/components/icons";

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
}

export function TextField({ label, mono, style, ...props }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View className="gap-2 flex-1">
      <FieldLabel>{label}</FieldLabel>
      <TextInput
        {...props}
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
            backgroundColor: "#FFFFFF",
            borderWidth: focused ? 1.5 : 1,
            borderColor: focused ? "#0E6274" : "#DCE3E6",
            fontSize: 15,
            color: "#101C21",
          },
          style,
        ]}
      />
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
  return (
    <Pressable
      onPress={onPress}
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
  return (
    <Pressable
      onPress={onPress}
      className="min-h-12 px-6 rounded-lg border border-owner-border items-center justify-center"
    >
      <Text className="font-plex-semibold text-owner-ink-muted text-[14.5px]">{label}</Text>
    </Pressable>
  );
}
