// Peek — press and hold a row to look inside it without leaving the page.
//
// A game row peeks its full standings; a player row peeks their whole day. It
// is not an RN `Modal`: a root-level absolutely-positioned overlay avoids the
// stacked-Modal wedge documented in the repo CLAUDE.md, and it lets the peek
// animate with the rest of the app.
//
// It opens on long-press *and* on a tap of the row's identity glyph (cover or
// avatar), so there is always a non-gesture way in — required on web, where a
// press-and-hold with a mouse is undiscoverable, and for anyone who can't hold.
// Once open it stays open: tap it to commit to the full screen, tap outside to
// dismiss. That is the iOS context-menu contract, and unlike a
// release-to-dismiss preview it works identically with a mouse.

import { haptics } from "@workshop/ui";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Pressable, Text as RNText, ScrollView, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { PixelIcon, pixelType, tokens } from "../theme";

export interface PeekRequest {
  /** ALL-CAPS pixel title — the thing you're looking at. */
  title: string;
  /** Quiet line under the title: turnout, mean rank, whatever the row hides. */
  subtitle?: string;
  content: ReactNode;
  /** Tapping the panel commits to the full screen. */
  onCommit?: () => void;
  commitLabel?: string;
}

interface PeekContextValue {
  openPeek: (request: PeekRequest) => void;
  closePeek: () => void;
}

const PeekContext = createContext<PeekContextValue | null>(null);

export function PeekProvider({ children }: { children: ReactNode }) {
  const [peek, setPeek] = useState<PeekRequest | null>(null);
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  const openPeek = useCallback((request: PeekRequest) => {
    haptics.selection();
    setPeek(request);
  }, []);
  const closePeek = useCallback(() => setPeek(null), []);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = peek ? 1 : 0;
      return;
    }
    progress.value = withTiming(peek ? 1 : 0, {
      duration: tokens.motion.base,
      easing: Easing.out(Easing.quad),
    });
  }, [peek, progress, reduceMotion]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const panelStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.96 + progress.value * 0.04 }],
  }));

  const value = useMemo(() => ({ openPeek, closePeek }), [openPeek, closePeek]);

  return (
    <PeekContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        {peek ? (
          <View style={StyleSheet.absoluteFill} testID="peek-overlay">
            <Animated.View style={[styles.backdrop, backdropStyle]} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close preview"
              style={StyleSheet.absoluteFill}
              onPress={closePeek}
              testID="peek-backdrop"
            />
            <View style={styles.center}>
              <Animated.View style={[styles.panelWrap, panelStyle]}>
                <View style={styles.panel} testID="peek-panel">
                  <View style={styles.header}>
                    <RNText numberOfLines={1} style={styles.title}>
                      {peek.title}
                    </RNText>
                    {peek.subtitle ? (
                      <RNText numberOfLines={1} style={styles.subtitle}>
                        {peek.subtitle}
                      </RNText>
                    ) : null}
                  </View>
                  <ScrollView
                    style={styles.body}
                    contentContainerStyle={styles.bodyContent}
                    showsVerticalScrollIndicator={false}
                  >
                    {peek.content}
                  </ScrollView>
                  {peek.onCommit ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${peek.commitLabel ?? "Open"} ${peek.title}`}
                      onPress={() => {
                        const commit = peek.onCommit;
                        closePeek();
                        commit?.();
                      }}
                      testID="peek-commit"
                      style={({ pressed }) => [styles.commit, pressed && styles.commitPressed]}
                    >
                      <RNText style={styles.commitLabel}>{peek.commitLabel ?? "Open"}</RNText>
                      <PixelIcon name="chevron-right" size={16} color={tokens.neon.pinkTint} />
                    </Pressable>
                  ) : null}
                </View>
              </Animated.View>
            </View>
          </View>
        ) : null}
      </View>
    </PeekContext.Provider>
  );
}

export function usePeek(): PeekContextValue {
  const ctx = useContext(PeekContext);
  if (!ctx) throw new Error("usePeek must be used inside PeekProvider");
  return ctx;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(6,4,10,0.82)",
    pointerEvents: "none",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: tokens.space.lg,
    // Taps in the dimmed area have to reach the backdrop behind this host.
    pointerEvents: "box-none",
  },
  panelWrap: { width: "100%", maxWidth: 360 },
  panel: {
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
    paddingTop: tokens.space.sm,
  },
  header: {
    paddingHorizontal: tokens.space.md,
    paddingBottom: tokens.space.sm,
    gap: 2,
  },
  title: { ...pixelType(11), color: tokens.text.primary },
  subtitle: { fontSize: tokens.font.size.xs, lineHeight: 16, color: tokens.text.secondary },
  body: { maxHeight: 320 },
  bodyContent: { paddingHorizontal: tokens.space.md },
  commit: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    borderTopWidth: tokens.bezel,
    borderTopColor: tokens.border.default,
  },
  commitPressed: { backgroundColor: tokens.bg.elevated },
  commitLabel: { ...pixelType(9, 1.6), color: tokens.neon.pinkTint },
});
