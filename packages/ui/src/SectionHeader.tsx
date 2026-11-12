import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { layout } from "./Layout";
import { Text } from "./Text";
import { tokens } from "./theme";

export interface SectionHeaderProps {
  title: string;
  /** Quiet trailing meta or a small action (a count, "Clear"). */
  trailing?: ReactNode;
  /**
   * The first thing on the screen (or in its block): drops the section space
   * above. Every other header sits `layout.sectionTop` below what precedes it.
   */
  first?: boolean;
  /**
   * Indent by the page gutter (default). Pass `false` inside a block that is
   * already padded by the gutter (a form, a card).
   */
  inset?: boolean;
  style?: ViewStyle;
  testID?: string;
}

/**
 * The uppercase tracked label above a group of rows or fields. Owns the one
 * section rhythm: 24 above (unless `first`), 4 below, text on the gutter.
 */
export function SectionHeader({
  title,
  trailing,
  first = false,
  inset = true,
  style,
  testID,
}: SectionHeaderProps) {
  return (
    <View
      style={[styles.root, first && styles.first, inset && styles.inset, style]}
      testID={testID}
    >
      {/* A level-2 heading: the screen title is the one level 1 (react-native-web
          renders a bare header role as an <h1>). */}
      <Text variant="eyebrow" headerRole={2} style={styles.title}>
        {title}
      </Text>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space.sm,
    minHeight: tokens.space.xl,
    paddingTop: layout.sectionTop,
    paddingBottom: layout.sectionBottom,
  },
  // Directly under the screen header: a small step, not a section break.
  first: { paddingTop: tokens.space.sm },
  inset: { paddingHorizontal: layout.gutter },
  title: { flexShrink: 1 },
});
