import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";

import { ChevronDownIcon } from "@/components/icons";
import { CloseIcon } from "./icons";
import { OV } from "@/lib/overview";

/** A bottom sheet (Modal, so it also works on Expo web). Mount it only while open. */
export function BottomSheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
  tall,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  tall?: boolean;
}) {
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Pressable
          className="flex-1 justify-end"
          style={{ backgroundColor: "rgba(12,31,29,0.45)" }}
          onPress={onClose}
        >
          <Pressable
            className="bg-owner-surface rounded-t-3xl"
            style={{ maxHeight: "92%", height: tall ? "92%" : undefined }}
            onPress={(e) => e.stopPropagation?.()}
          >
            <View className="flex-row items-start justify-between gap-3 px-5 pt-5 pb-3">
              <View className="flex-1 gap-1">
                <Text className="font-plex-bold text-owner-ink text-[20px] -tracking-[0.3px]" accessibilityRole="header">
                  {title}
                </Text>
                {subtitle ? <Text className="font-plex-medium text-owner-ink-faint text-[13px]">{subtitle}</Text> : null}
              </View>
              <Pressable
                onPress={onClose}
                accessibilityLabel="Close"
                accessibilityRole="button"
                className="w-11 h-11 rounded-xl border border-owner-border items-center justify-center"
              >
                <CloseIcon />
              </Pressable>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerClassName="px-5 pb-6 gap-3"
              style={{ flexGrow: 0, flexShrink: 1 }}
            >
              {children}
            </ScrollView>
            {footer ? <View className="px-5 pb-7 pt-2 border-t border-owner-border-light">{footer}</View> : null}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Pill({
  label,
  selected,
  onPress,
  tone = "neutral",
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  tone?: "neutral" | "green" | "red" | "amber";
}) {
  const tint = {
    neutral: { bg: "#EDF1F2", fg: OV.ink },
    green: { bg: OV.accentSoft, fg: OV.accent },
    red: { bg: "#EFEDEB", fg: OV.ink },
    amber: { bg: OV.amberBg, fg: OV.amberDark },
  }[tone];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className="px-3.5 rounded-full items-center justify-center"
      style={{ minHeight: 44, backgroundColor: selected ? OV.ink : tint.bg }}
    >
      <Text className="font-plex-semibold text-[13px]" style={{ color: selected ? "#FFFFFF" : tint.fg }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Looks like a dropdown field; opens a sheet. */
export function SelectButton({
  label,
  value,
  onPress,
  disabled,
  compact,
}: {
  label?: string;
  value: string;
  onPress: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <View className={compact ? "" : "gap-1.5"}>
      {label ? <Text className="font-plex-semibold text-owner-ink-muted text-[12.5px]">{label}</Text> : null}
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label ? `${label}: ${value}` : value}
        className="flex-row items-center justify-between rounded-xl bg-owner-surface px-4"
        style={{ minHeight: compact ? 44 : 52, borderWidth: 1.5, borderColor: disabled ? OV.border : OV.ink, opacity: disabled ? 0.6 : 1 }}
      >
        <Text className="font-plex-semibold text-owner-ink text-[15px] flex-1" numberOfLines={1}>
          {value}
        </Text>
        <ChevronDownIcon color={OV.ink} />
      </Pressable>
    </View>
  );
}

export function OutlineButton({ label, onPress, flex }: { label: string; onPress: () => void; flex?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className={`${flex ? "flex-1" : ""} rounded-xl bg-owner-surface items-center justify-center px-3`}
      style={{ minHeight: 48, borderWidth: 1.5, borderColor: OV.ink }}
    >
      <Text className="font-plex-semibold text-owner-ink text-[14px]">{label}</Text>
    </Pressable>
  );
}

export function OrangeButton({
  label,
  onPress,
  flex,
  disabled,
}: {
  label: string;
  onPress: () => void;
  flex?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      className={`${flex ? "flex-1" : ""} rounded-xl items-center justify-center px-3`}
      style={{ minHeight: 48, backgroundColor: OV.orange, opacity: disabled ? 0.5 : 1 }}
    >
      <Text className="font-plex-bold text-owner-ink text-[14px]">{label}</Text>
    </Pressable>
  );
}

export function SmallChip({ label, bg, fg, icon, onPress }: { label: string; bg: string; fg: string; icon?: ReactNode; onPress?: () => void }) {
  const inner = (
    <View className="flex-row items-center gap-1 px-2.5 rounded-full" style={{ backgroundColor: bg, minHeight: 26 }}>
      {icon}
      <Text className="font-plex-semibold text-[11.5px]" style={{ color: fg }}>
        {label}
      </Text>
    </View>
  );
  if (!onPress) return inner;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8}>
      {inner}
    </Pressable>
  );
}

export function Checkbox({ checked, label, sub, onPress }: { checked: boolean; label: string; sub?: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      className="flex-row items-center gap-3"
      style={{ minHeight: 48 }}
    >
      <View
        className="w-6 h-6 rounded-md items-center justify-center"
        style={{ borderWidth: 2, borderColor: checked ? OV.accent : OV.faint, backgroundColor: checked ? OV.accent : "#FFFFFF" }}
      >
        {checked ? <Text className="font-plex-bold text-white text-[14px] leading-[16px]">{"✓"}</Text> : null}
      </View>
      <View className="flex-1">
        <Text className="font-plex-semibold text-owner-ink text-[15px]">{label}</Text>
        {sub ? <Text className="font-plex-medium text-owner-ink-faint text-[12px]">{sub}</Text> : null}
      </View>
    </Pressable>
  );
}
