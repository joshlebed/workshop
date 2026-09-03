// The three keys the whole app hangs off. Not a tab bar in the routing sense —
// pressing a key crossfades the panel above it with an 8px step; nothing is
// pushed and nothing animates in from the side of the screen.
//
// One bar, not two: the copy-today's-scores action lives on the shelf (the
// only surface that spans every game), so the panel never grows a second row.

import { Pressable, StyleSheet, View } from "react-native";
import { deck, PixelIcon, type PixelIconName, Text, tokens } from "../theme";
import type { Panel } from "./DeckNav";

const KEYS: { panel: Panel; label: string; icon: PixelIconName }[] = [
  { panel: "deck", label: "Deck", icon: "layout" },
  { panel: "players", label: "Players", icon: "users" },
  { panel: "you", label: "You", icon: "user" },
];

interface ControlPanelProps {
  panel: Panel;
  onSelect: (panel: Panel) => void;
  /** Inbound friend requests — spotlighted on the PLAYERS key, not badged. */
  pendingRequests: number;
}

export function ControlPanel({ panel, onSelect, pendingRequests }: ControlPanelProps) {
  return (
    <View style={styles.panel} testID="control-panel">
      {KEYS.map((key) => {
        const active = key.panel === panel;
        const spotlight = key.panel === "players" && pendingRequests > 0;
        const color = active
          ? tokens.neon.pink
          : spotlight
            ? tokens.neon.yellow
            : tokens.text.secondary;
        return (
          <Pressable
            key={key.panel}
            accessibilityRole="tab"
            accessibilityLabel={spotlight ? `${key.label}, ${pendingRequests} waiting` : key.label}
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(key.panel)}
            testID={`panel-key-${key.panel}`}
            style={({ pressed }) => [
              styles.key,
              active && styles.keyActive,
              pressed && styles.keyPressed,
            ]}
          >
            <PixelIcon name={key.icon} size={16} color={color} />
            <Text variant="heading" style={[styles.keyLabel, { color }]}>
              {spotlight ? `${key.label} ${pendingRequests}` : key.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flexDirection: "row",
    height: deck.panelHeight,
    borderTopWidth: tokens.bezel,
    borderTopColor: tokens.border.default,
    backgroundColor: tokens.bg.canvas,
  },
  key: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    // The active key is lit from the top edge — the seam the panel shares
    // with the surface above it.
    borderTopWidth: tokens.bezel,
    borderTopColor: "transparent",
    marginTop: -tokens.bezel,
  },
  keyActive: { borderTopColor: tokens.neon.pink },
  keyPressed: { backgroundColor: tokens.bg.surface },
  keyLabel: { fontSize: 10, lineHeight: 14 },
});
