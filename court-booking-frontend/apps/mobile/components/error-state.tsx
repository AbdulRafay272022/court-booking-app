import { Pressable, Text, View } from "react-native";
import { AlertTriangleIcon, RefreshIcon } from "./icons";

/** Distinct failure state for a screen's primary data fetch — Section 12: never leave a
 * failed network call as an infinite spinner or a silently-blank screen. Shared between
 * both design systems via `tone` rather than duplicated per app-section. */
export function ErrorState({
  message,
  onRetry,
  tone = "player",
}: {
  message: string;
  onRetry: () => void;
  tone?: "player" | "owner";
}) {
  const isOwner = tone === "owner";
  const titleFont = isOwner ? "font-plex-bold" : "font-figtree-bold";
  const bodyFont = isOwner ? "font-plex-medium" : "font-figtree-medium";
  const buttonFont = isOwner ? "font-plex-semibold" : "font-figtree-semibold";
  const inkClass = isOwner ? "text-owner-ink" : "text-player-ink";
  const faintClass = isOwner ? "text-owner-ink-faint" : "text-player-ink-faint";
  const accentClass = isOwner ? "bg-owner-accent" : "bg-player-accent";

  return (
    <View className="flex-1 items-center justify-center gap-3 px-8">
      <AlertTriangleIcon />
      <Text className={`${titleFont} ${inkClass} text-base text-center`}>Something went wrong</Text>
      <Text className={`${bodyFont} ${faintClass} text-sm text-center`}>{message}</Text>
      <Pressable
        onPress={onRetry}
        className={`flex-row items-center gap-2 px-4 rounded-lg mt-1 ${accentClass}`}
        style={{ minHeight: 44 }}
      >
        <RefreshIcon />
        <Text className={`${buttonFont} text-white text-[13.5px]`}>Try again</Text>
      </Pressable>
    </View>
  );
}
