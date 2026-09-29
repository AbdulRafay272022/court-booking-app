import { useEffect, useRef, useState } from "react";
import {
  Image,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

/**
 * A real photo gallery: a swipeable pager whose photos FILL a fixed aspect-ratio box (resizeMode "cover", so a small,
 * portrait or panoramic upload never leaves an empty area), an "n / total" counter plus dots, prev/next buttons (a mouse
 * cannot swipe on web), and a thumbnail strip with a visible scrollbar that follows the selection. One photo = just the
 * photo, no controls. Used for the venue and for each court.
 */
export function PhotoGallery({
  photos,
  aspectRatio = 16 / 10,
  thumbnails = true,
  label,
}: {
  photos: string[];
  aspectRatio?: number;
  thumbnails?: boolean;
  label?: string;
}) {
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const pager = useRef<ScrollView>(null);
  const strip = useRef<ScrollView>(null);
  const THUMB_W = 72;
  const THUMB_GAP = 8;

  // If photos are removed/reordered while mounted, keep the selection in range.
  const current = Math.min(index, Math.max(0, photos.length - 1));

  function goTo(i: number, animated = true) {
    const next = Math.max(0, Math.min(photos.length - 1, i));
    setIndex(next);
    pager.current?.scrollTo({ x: next * width, animated });
  }

  useEffect(() => {
    // keep the selected thumbnail in view
    strip.current?.scrollTo({ x: Math.max(0, current * (THUMB_W + THUMB_GAP) - 80), animated: true });
  }, [current]);

  function onScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (width <= 0) return;
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  }

  if (photos.length === 0) return null;
  const multiple = photos.length > 1;

  return (
    <View accessibilityLabel={label ? `${label} photos` : "Photos"} className="gap-2">
      <View
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        style={{ width: "100%", aspectRatio, overflow: "hidden", backgroundColor: "#E8E2DC" }}
        className="rounded-[14px]"
      >
        {width > 0 ? (
          <ScrollView
            ref={pager}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEnabled={multiple}
            onMomentumScrollEnd={onScrollEnd}
            onScrollEndDrag={onScrollEnd}
            style={{ width, height: "100%" }}
          >
            {photos.map((url, i) => (
              <Image
                key={`${i}-${url}`}
                source={{ uri: url }}
                accessibilityLabel={`Photo ${i + 1} of ${photos.length}`}
                resizeMode="cover"
                style={{ width, height: "100%" }}
              />
            ))}
          </ScrollView>
        ) : null}

        {multiple ? (
          <>
            <View className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-full" style={{ backgroundColor: "rgba(20,26,29,0.7)" }}>
              <Text className="font-figtree-bold text-white text-[12px]">
                {current + 1} / {photos.length}
              </Text>
            </View>
            <View pointerEvents="none" className="absolute bottom-2.5 left-0 right-0 flex-row justify-center gap-1.5">
              {photos.map((_, i) => (
                <View
                  key={i}
                  style={{
                    width: i === current ? 16 : 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: i === current ? "#FFFFFF" : "rgba(255,255,255,0.55)",
                  }}
                />
              ))}
            </View>
            {current > 0 ? (
              <Pressable
                accessibilityLabel="Previous photo"
                onPress={() => goTo(current - 1)}
                className="absolute left-2 top-1/2 -mt-5 w-10 h-10 rounded-full items-center justify-center"
                style={{ backgroundColor: "rgba(20,26,29,0.55)" }}
              >
                <Text className="text-white text-[22px] font-figtree-bold -mt-0.5">‹</Text>
              </Pressable>
            ) : null}
            {current < photos.length - 1 ? (
              <Pressable
                accessibilityLabel="Next photo"
                onPress={() => goTo(current + 1)}
                className="absolute right-2 top-1/2 -mt-5 w-10 h-10 rounded-full items-center justify-center"
                style={{ backgroundColor: "rgba(20,26,29,0.55)" }}
              >
                <Text className="text-white text-[22px] font-figtree-bold -mt-0.5">›</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </View>

      {multiple && thumbnails ? (
        <ScrollView
          ref={strip}
          horizontal
          showsHorizontalScrollIndicator
          contentContainerStyle={{ gap: THUMB_GAP, paddingBottom: 8, paddingRight: 4 }}
        >
          {photos.map((url, i) => (
            <Pressable
              key={`${i}-${url}`}
              accessibilityLabel={`Show photo ${i + 1}`}
              onPress={() => goTo(i)}
              style={{
                width: THUMB_W,
                height: 54,
                borderRadius: 8,
                overflow: "hidden",
                borderWidth: 2,
                borderColor: i === current ? "#EF5A2C" : "transparent",
                opacity: i === current ? 1 : 0.75,
              }}
            >
              <Image source={{ uri: url }} resizeMode="cover" style={{ width: "100%", height: "100%" }} />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}
