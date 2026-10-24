import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
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
import { FontScaleProvider, LangProvider, RoleProvider, useCopy, useFontScale, useLang, useReduceMotion, useRole } from "./theme";
import { ToastBridge, useToast } from "./Toast";
import { createSheetLifecycle } from "./sheet-lifecycle";

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
  // The modal renders in the @gorhom portal at the app root, OUTSIDE the route group's providers: read them here and
  // re-provide them around the content, so an owner sheet stays teal (never the player default), keeps the language,
  // the dev font scale and the role layout's toasts.
  const role = useRole();
  const lang = useLang();
  const fontScale = useFontScale();
  const toast = useToast();

  // Latest onClose (the modal keeps the callback from its last committed render while it animates out).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const life = useRef(createSheetLifecycle()).current;
  // The modal's imperative handle, kept for the unmount cleanup (refs are detached before cleanups run).
  const handle = useRef<BottomSheetModal | null>(null);
  useLayoutEffect(() => {
    if (ref.current) handle.current = ref.current;
  });

  useEffect(() => {
    const action = life.setOpen(open);
    if (action === "present") ref.current?.present();
    else if (action === "dismiss") ref.current?.dismiss();
  }, [open, life]);

  // Unmounted while open: close at once (no ~1 s close animation over the next screen) and never call the gone owner.
  useLayoutEffect(() => {
    life.mount();
    return () => {
      if (life.unmount() === "dismissInstant") (handle.current ?? ref.current)?.dismiss({ duration: 0 });
    };
  }, [life]);

  const handleDismiss = useCallback(() => {
    if (life.dismissed() === "notifyClose") onCloseRef.current();
  }, [life]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" style={[props.style, { backgroundColor: alpha.scrim }]} opacity={1} />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={ref}
      onDismiss={handleDismiss}
      // "push": a sheet opened while another is open stacks on top and the first stays as it is ("switch", the default,
      // minimised the first one and on Expo web it never came back: both looked dismissed).
      stackBehavior="push"
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
      <RoleProvider role={role}>
      <LangProvider lang={lang}>
      <FontScaleProvider scale={fontScale}>
      <ToastBridge value={toast}>
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
      </ToastBridge>
      </FontScaleProvider>
      </LangProvider>
      </RoleProvider>
    </BottomSheetModal>
  );
}
