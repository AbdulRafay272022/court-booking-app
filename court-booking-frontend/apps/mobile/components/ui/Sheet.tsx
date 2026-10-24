import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { ReduceMotion } from "react-native-reanimated";
import { X } from "lucide-react-native";
import { alpha, palette, radius, space } from "@court-booking/ui-tokens";
import { IconButton } from "./IconButton";
import { Text } from "./Text";
import { useCopy, useReduceMotion, useRoleTheme } from "./theme";

export interface SheetProps {
  /** Controlled: true presents, false dismisses. */
  open: boolean;
  /** Called after the sheet is dismissed (backdrop tap, swipe down, close button, Android back). */
  onClose: () => void;
  title?: string;
  subtitle?: string;
  /** Area under the content (e.g. the confirm button), separated by a divider. */
  footer?: ReactNode;
  children: ReactNode;
  /** Hide the 44pt close button (keep the handle + backdrop). */
  hideClose?: boolean;
  testID?: string;
}

/**
 * Bottom sheet on @gorhom/bottom-sheet (BottomSheetModal, needs the BottomSheetModalProvider already in app/_layout.tsx).
 * Sizes to its content (dynamic sizing) up to the screen height; content scrolls. Works on Expo web.
 * Radius 30 (System board), scrim night 50%, close button "Band karein" 44pt. Respects reduce-motion.
 */
export function Sheet({ open, onClose, title, subtitle, footer, children, hideClose, testID }: SheetProps) {
  const ref = useRef<BottomSheetModal>(null);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const copy = useCopy();
  useRoleTheme();

  // Only dismiss a sheet that was presented: dismiss() on a never-mounted BottomSheetModal leaves it in DISMISSING status,
  // and a later present() then never renders its portal (found on Expo web).
  const presented = useRef(false);
  useEffect(() => {
    if (open) {
      presented.current = true;
      ref.current?.present();
    } else if (presented.current) {
      presented.current = false;
      ref.current?.dismiss();
    }
  }, [open]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" style={[props.style, { backgroundColor: alpha.scrim }]} opacity={1} />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={ref}
      onDismiss={() => {
        presented.current = false;
        onClose();
      }}
      enableDynamicSizing
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      overrideReduceMotion={reduceMotion ? ReduceMotion.Always : ReduceMotion.System}
      backgroundStyle={{ backgroundColor: palette.white, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet }}
      handleIndicatorStyle={{ backgroundColor: palette.lineStrong, width: 40, height: 5 }}
      topInset={insets.top + space[4]}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
    >
      <BottomSheetScrollView
        testID={testID}
        contentContainerStyle={{ paddingHorizontal: space[5], paddingBottom: space[5] + insets.bottom, gap: space[4] }}
      >
        {title || !hideClose ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3] }}>
            <View style={{ flex: 1, gap: 2 }}>
              {title ? (
                <Text variant="h3" accessibilityRole="header">
                  {title}
                </Text>
              ) : null}
              {subtitle ? (
                <Text variant="meta" tone="muted">
                  {subtitle}
                </Text>
              ) : null}
            </View>
            {!hideClose ? <IconButton icon={X} variant="mist" accessibilityLabel={copy("Band karein", "Close")} onPress={() => ref.current?.dismiss()} testID={testID ? `${testID}-close` : undefined} /> : null}
          </View>
        ) : null}
        {children}
        {/* Footer (confirm button) is the last block of the content: @gorhom dynamic sizing measures only the scroll content,
            so a separate sticky footer hid the last rows on Expo web. */}
        {footer ? <View style={{ paddingTop: space[3], borderTopWidth: 1, borderTopColor: palette.divider }}>{footer}</View> : null}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}
