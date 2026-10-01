// The bottom control panel — three hard keys, always in reach, always the way
// out of wherever you are. Deliberately label-only in Press Start 2P rather
// than the usual icon-over-label tab bar: these are cabinet keys, and three
// short words carry the whole map of the app without a row of decorative
// glyphs. The lit key is the current surface.
//
// FRIENDS, not PLAYERS: the home screen's projection switch owns that word (see
// ProjectionSwitch). This key is the social graph — requests, mutuals, invites.

import { type Href, useRouter } from "expo-router";
import { Pressable, Text as RNText, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { glow, pixelType, tokens } from "../theme";

export type PanelKey = "today" | "friends" | "you";

const KEYS: { id: PanelKey; label: string; href: Href }[] = [
  { id: "today", label: "Today", href: "/" as Href },
  { id: "friends", label: "Friends", href: "/friends" as Href },
  { id: "you", label: "You", href: "/you" as Href },
];

interface KeyPanelProps {
  active: PanelKey;
  /** Inbound friend requests — spotlighted on the PLAYERS key. */
  pending?: number;
}

export function KeyPanel({ active, pending = 0 }: KeyPanelProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.panel, { paddingBottom: insets.bottom }]} testID="key-panel">
      {KEYS.map((key) => {
        const isActive = key.id === active;
        const badge = key.id === "friends" && pending > 0 ? pending : 0;
        return (
          <Pressable
            key={key.id}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={badge > 0 ? `${key.label}, ${badge} requests` : key.label}
            testID={`key-${key.id}`}
            // Always navigate, even when the key is lit: a detail screen lights
            // the section it belongs to, and tapping that key is how you get
            // back to the section root. Navigating to where you already are is
            // a no-op.
            onPress={() => router.navigate(key.href)}
            style={({ pressed }) => [
              styles.key,
              isActive && styles.keyActive,
              pressed && !isActive && styles.keyPressed,
            ]}
          >
            <View style={styles.labelWrap}>
              <RNText style={[styles.label, isActive && styles.labelActive]}>{key.label}</RNText>
              {badge > 0 ? (
                <View style={styles.badge} testID="key-friends-badge">
                  <RNText style={styles.badgeText}>{badge > 9 ? "9+" : badge}</RNText>
                </View>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flexDirection: "row",
    borderTopWidth: tokens.bezel,
    borderTopColor: tokens.border.default,
    backgroundColor: tokens.bg.canvas,
  },
  key: {
    flex: 1,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderTopWidth: tokens.bezel,
    borderTopColor: "transparent",
    // Hairline separators between keys come from the shared bezel: each key
    // after the first draws its own left edge.
    borderLeftWidth: tokens.bezel,
    borderLeftColor: tokens.border.default,
    marginTop: -tokens.bezel,
    marginLeft: -tokens.bezel,
  },
  // The lit key: pink top edge and pink label. The glow is deliberately narrow
  // — a wide halo on a 52pt-tall key floods the whole cell.
  keyActive: { borderTopColor: tokens.neon.pink, ...glow(tokens.neon.pinkGlow, 5) },
  keyPressed: { backgroundColor: tokens.bg.elevated },
  label: { ...pixelType(10, 1.4), color: tokens.text.secondary },
  labelActive: { color: tokens.neon.pink },
  labelWrap: { alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    top: -9,
    right: -17,
    minWidth: 14,
    height: 14,
    paddingHorizontal: 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.neon.yellow,
  },
  badgeText: {
    ...pixelType(8, 1.6),
    color: tokens.text.onAccent,
    letterSpacing: 0,
  },
});
