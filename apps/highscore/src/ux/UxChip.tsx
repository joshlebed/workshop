// The playground's only chrome: a floating "UX" chip, on every screen.
//
// Deliberately neutral — DESIGN.md's grey/purple surfaces and the standard 2px
// bezel, no neon fill, no pixel face. It is review scaffolding sitting on top of
// five competing designs, and a styled-up control would bias whichever variant
// it happened to flatter. It is also built from raw RN primitives rather than
// any variant's `theme/`, so it looks identical in all five.
//
// Tap it for the picker. Drag it if it's covering something. On web, Alt+1…Alt+5
// switch variants without opening anything (see `./variant.tsx`).

import { useCallback, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CHROME } from "./chrome";
import { VARIANT_CHIP_BOTTOM } from "./shells";
import { useUxVariantControls } from "./variant";
import { UX_VARIANT_META, UX_VARIANTS, type UxVariant } from "./variants";

const {
  ink: INK,
  surface1: SURFACE_1,
  surface2: SURFACE_2,
  surface3: SURFACE_3,
  border: BORDER,
  textPrimary: TEXT_PRIMARY,
  textSecondary: TEXT_SECONDARY,
  bezel: BEZEL,
} = CHROME;

export function UxChip() {
  const { variant, setVariant, reset } = useUxVariantControls();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(false);

  // Drag-to-reposition, so the chip can never permanently hide something a
  // reviewer wants to see. Offsets only — the resting place is still the
  // variant-aware bottom-right corner.
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const pan = Gesture.Pan()
    // Tapping must stay a tap: the pan only takes over after a real drag.
    .activeOffsetX([-8, 8])
    .activeOffsetY([-8, 8])
    .onStart(() => {
      startX.value = dx.value;
      startY.value = dy.value;
    })
    .onUpdate((event) => {
      dx.value = startX.value + event.translationX;
      dy.value = startY.value + event.translationY;
    });
  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dx.value }, { translateY: dy.value }],
  }));

  const pick = useCallback(
    (next: UxVariant) => {
      setVariant(next);
      setOpen(false);
    },
    [setVariant],
  );

  const handleReset = useCallback(() => {
    reset();
    setOpen(false);
  }, [reset]);

  const sheetWidth = Math.min(width - 24, 420);

  return (
    <>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            styles.anchor,
            { bottom: insets.bottom + VARIANT_CHIP_BOTTOM[variant], right: 12 + insets.right },
            dragStyle,
          ]}
          pointerEvents="box-none"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`UX variant: ${variant} — ${UX_VARIANT_META[variant].name}. Switch variant.`}
            testID="ux-chip"
            onPress={() => setOpen(true)}
            style={({ pressed }) => [styles.chip, pressed ? styles.chipPressed : null]}
          >
            <Text style={styles.chipKicker}>UX</Text>
            <Text style={styles.chipValue}>{variant.replace("ux", "")}</Text>
          </Pressable>
        </Animated.View>
      </GestureDetector>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            testID="ux-sheet-backdrop"
            onPress={() => setOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[styles.sheet, { width: sheetWidth, marginBottom: insets.bottom + 12 }]}
            testID="ux-sheet"
          >
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>UX exploration</Text>
              <Text style={styles.sheetHint}>
                {Platform.OS === "web" ? "Alt+1…5, or ?ux=ux3 on any URL" : "Review playground"}
              </Text>
            </View>
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {UX_VARIANTS.map((key) => {
                const meta = UX_VARIANT_META[key];
                const active = key === variant;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    testID={`ux-option-${key}`}
                    onPress={() => pick(key)}
                    style={({ pressed }) => [
                      styles.option,
                      active ? styles.optionActive : null,
                      pressed ? styles.optionPressed : null,
                    ]}
                  >
                    <View style={styles.optionHead}>
                      <Text style={styles.optionKey}>{key.toUpperCase()}</Text>
                      <Text style={styles.optionName}>{meta.name}</Text>
                      <Text style={styles.optionMark}>{active ? "●" : ""}</Text>
                    </View>
                    <Text style={styles.optionBlurb}>{meta.blurb}</Text>
                    <Text style={styles.optionRef}>{`PR #${meta.pr} · ${meta.branch}`}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              testID="ux-reset"
              onPress={handleReset}
              style={({ pressed }) => [styles.reset, pressed ? styles.optionPressed : null]}
            >
              <Text style={styles.resetLabel}>Reset app state</Text>
              <Text style={styles.resetHint}>Clears the saved variant and returns to ux1</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  anchor: { position: "absolute" },
  chip: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: SURFACE_2,
    borderWidth: BEZEL,
    borderColor: BORDER,
    ...(Platform.OS === "web" ? { cursor: "pointer" as never } : null),
  },
  chipPressed: { backgroundColor: SURFACE_3 },
  chipKicker: {
    color: TEXT_SECONDARY,
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: "600",
  },
  chipValue: { color: TEXT_PRIMARY, fontSize: 13, fontWeight: "700" },
  modalRoot: { flex: 1, justifyContent: "flex-end", alignItems: "center" },
  sheet: {
    maxHeight: "82%",
    backgroundColor: SURFACE_1,
    borderWidth: BEZEL,
    borderColor: BORDER,
  },
  sheetHeader: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: BEZEL,
    borderBottomColor: BORDER,
    gap: 2,
  },
  sheetTitle: { color: TEXT_PRIMARY, fontSize: 15, fontWeight: "700" },
  sheetHint: { color: TEXT_SECONDARY, fontSize: 11 },
  list: { flexGrow: 0 },
  listContent: { padding: 8, gap: 6 },
  option: {
    padding: 10,
    gap: 4,
    backgroundColor: SURFACE_2,
    borderWidth: BEZEL,
    borderColor: "transparent",
    ...(Platform.OS === "web" ? { cursor: "pointer" as never } : null),
  },
  optionActive: { borderColor: BORDER, backgroundColor: SURFACE_3 },
  optionPressed: { backgroundColor: SURFACE_3 },
  optionHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  optionKey: {
    color: TEXT_SECONDARY,
    fontSize: 10,
    letterSpacing: 1.2,
    fontWeight: "700",
    minWidth: 26,
  },
  optionName: { color: TEXT_PRIMARY, fontSize: 14, fontWeight: "700", flex: 1 },
  optionMark: { color: TEXT_PRIMARY, fontSize: 12 },
  optionBlurb: { color: TEXT_SECONDARY, fontSize: 12, lineHeight: 17 },
  optionRef: { color: TEXT_SECONDARY, fontSize: 10, opacity: 0.7 },
  reset: {
    margin: 8,
    marginTop: 0,
    padding: 10,
    gap: 2,
    borderWidth: BEZEL,
    borderColor: BORDER,
    backgroundColor: INK,
    ...(Platform.OS === "web" ? { cursor: "pointer" as never } : null),
  },
  resetLabel: { color: TEXT_PRIMARY, fontSize: 13, fontWeight: "600" },
  resetHint: { color: TEXT_SECONDARY, fontSize: 11 },
});
