// The timeline spine — a 2px rule down the left gutter that every day hangs
// off. It is the one continuous element in the feed; everything else is short
// and tight against it. The tick square doubles as the day's expand state:
// hollow = collapsed, filled = open, yellow = today.

import { StyleSheet, View } from "react-native";
import { tokens } from "../theme";

const TICK = 8;

export function SpineRule({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.rule} pointerEvents="none" />
      {children}
    </View>
  );
}

export function SpineTick({ tone }: { tone: "today" | "open" | "closed" }) {
  return (
    <View style={styles.tickSlot}>
      <View
        style={[
          styles.tick,
          tone === "today" && styles.tickToday,
          tone === "open" && styles.tickOpen,
          tone === "closed" && styles.tickClosed,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative" },
  rule: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: tokens.gutter / 2 - 1,
    width: tokens.bezel,
    backgroundColor: tokens.border.default,
  },
  tickSlot: { width: tokens.gutter, alignItems: "center" },
  tick: { width: TICK, height: TICK, borderWidth: tokens.bezel },
  tickToday: { backgroundColor: tokens.neon.yellow, borderColor: tokens.neon.yellow },
  tickOpen: { backgroundColor: tokens.text.secondary, borderColor: tokens.text.secondary },
  tickClosed: { backgroundColor: tokens.bg.canvas, borderColor: tokens.border.default },
});
