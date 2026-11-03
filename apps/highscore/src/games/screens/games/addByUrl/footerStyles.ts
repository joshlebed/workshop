// Frame styles shared by every add-by-link footer variant so they sit on the
// same baseline and only the interaction differs.

import { StyleSheet } from "react-native";
import { bodyType, homeLayout, tokens } from "../../../../theme";

export const footerStyles = StyleSheet.create({
  footer: {
    paddingHorizontal: homeLayout.horizontalInset,
    paddingTop: tokens.space.sm,
    gap: tokens.space.xs,
    borderTopWidth: tokens.bezel,
    borderTopColor: tokens.border.default,
    backgroundColor: tokens.bg.canvas,
  },
  label: { letterSpacing: 0.4, textTransform: "uppercase" },
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  urlBox: {
    flex: 1,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.sm,
    paddingHorizontal: tokens.space.md,
    backgroundColor: tokens.bg.elevated,
  },
  input: {
    ...bodyType(),
    paddingVertical: 10,
    color: tokens.text.primary,
    // ≥16 or iOS Safari zooms the page on focus (see root CLAUDE.md).
    fontSize: tokens.font.size.md,
  },
  hint: { minHeight: 16 },
});

export const INPUT_PLACEHOLDER = "wordle.com or any game's link";
