// A game's cartridge label: a bezelled plate carrying a two-character pixel
// monogram in a colour derived from the title.
//
// The deck used to render each game's favicon. Nine third-party favicons in a
// row — a photograph, an Apple emoji globe, the NYT "T", a screenshot — is a
// browser tab bar, not a shelf of cartridges, and it was the least pixel thing
// on every screen. A plate is consistent, legible at 24px, and belongs to us.

import { StyleSheet, View } from "react-native";
import { palette, Text, tokens } from "../theme";
import { monogramFor } from "./monogram";

// Drawn only from the spec's neons plus the purple steps: these are identity
// marks, the same carve-out the avatars take.
const SPINE = [
  palette.primary,
  palette.success,
  palette.accent,
  palette.primaryTint,
  palette.warning,
  palette.textSecondary,
] as const;

/** Deterministic per-title, so a game keeps its colour across every surface. */
function spineFor(title: string): string {
  let sum = 0;
  for (let i = 0; i < title.length; i++) sum += title.charCodeAt(i);
  return SPINE[sum % SPINE.length] ?? palette.primary;
}

interface CartridgeLabelProps {
  title: string;
  /** Deck-unique monogram; falls back to the title's own when omitted. */
  mark?: string;
  size?: number;
  /** The cartridge you're on: the plate lights its spine. */
  active?: boolean;
}

export function CartridgeLabel({ title, mark, size = 28, active = false }: CartridgeLabelProps) {
  const spine = spineFor(title);
  return (
    <View
      style={[
        styles.plate,
        { width: size, height: size, borderColor: active ? spine : tokens.border.default },
      ]}
      accessible={false}
    >
      <View style={[styles.spine, { backgroundColor: spine }]} />
      <Text
        variant="score"
        style={[styles.mono, { fontSize: Math.max(8, Math.round(size * 0.32)), color: spine }]}
      >
        {mark ?? monogramFor(title)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  plate: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.elevated,
    borderWidth: tokens.bezel,
  },
  // The label stripe across the top of a cartridge.
  spine: { position: "absolute", top: 0, left: 0, right: 0, height: 3 },
  mono: { letterSpacing: 0, marginTop: 3 },
});
