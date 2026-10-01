// Shared chrome for every sheet rendered by `SheetHost`.
//
// One header shape across the board: an ALL-CAPS pixel eyebrow naming what you
// are looking at, the subject on the line below, and exactly one closing
// affordance. When sheets are stacked (friends → a friend's profile) a back
// pip appears on the left; there is no generic chevron anywhere else in the
// app, so it reads as "up one level in this sheet", not "go back a screen".

import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { PixelIcon, Text, tokens } from "../theme";
import type { SheetNav } from "./SheetHost";

export interface SheetFrameProps {
  /**
   * Only when it says something the title doesn't. "GAME / MAPTAP" and
   * "ACCOUNT / JOSH" are the label twice; the content already tells you which
   * sheet you're in.
   */
  eyebrow?: string;
  title: string;
  /** Optional identity glyph left of the eyebrow — an avatar on a profile. */
  leading?: ReactNode;
  /** Optional subtitle line under the title (host, relationship, turnout…). */
  meta?: ReactNode;
  /** Tapping the title does something (open the game's site, say). */
  onPressTitle?: () => void;
  onPressTitleLabel?: string;
  /** Pinned above the scroll area — day pagers, relationship actions. */
  sub?: ReactNode;
  /** Pinned to the bottom edge — composers. */
  footer?: ReactNode;
  nav: SheetNav;
  children: ReactNode;
  testID?: string;
}

export function SheetFrame({
  eyebrow,
  title,
  leading,
  meta,
  onPressTitle,
  onPressTitleLabel,
  sub,
  footer,
  nav,
  children,
  testID,
}: SheetFrameProps) {
  // Press Start 2P is wide: a long name set at display size wraps to two
  // lines and stops reading as a title. Step down instead of wrapping.
  const titleNode = (
    <Text variant={title.length > 13 ? "title" : "display"} numberOfLines={1} style={styles.title}>
      {title}
    </Text>
  );

  return (
    <View style={styles.root} testID={testID}>
      <View style={styles.header}>
        {nav.depth > 1 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={nav.back}
            hitSlop={10}
            testID="sheet-back"
            style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
          >
            <PixelIcon name="arrow-left" size={16} color={tokens.text.secondary} />
          </Pressable>
        ) : null}
        {leading}
        <View style={styles.headerText}>
          {eyebrow ? (
            <Text variant="eyebrow" tone="secondary">
              {eyebrow}
            </Text>
          ) : null}
          {onPressTitle ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={onPressTitleLabel ?? title}
              onPress={onPressTitle}
              testID="sheet-title-link"
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.titlePress,
                (pressed || hovered) && styles.titlePressed,
              ]}
            >
              {titleNode}
              <PixelIcon name="external-link" size={16} color={tokens.neon.pink} />
            </Pressable>
          ) : (
            titleNode
          )}
          {meta ? <View style={styles.meta}>{meta}</View> : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={nav.close}
          hitSlop={10}
          testID="sheet-close"
          style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
        >
          <PixelIcon name="close" size={16} color={tokens.text.secondary} />
        </Pressable>
      </View>

      {sub}

      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        bottomOffset={tokens.space.lg}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </KeyboardAwareScrollView>

      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  // `flexShrink` not `flex`: the sheet sizes to its content until it hits the
  // host's ceiling, so a short sheet has no dead space under it.
  root: { flexShrink: 1 },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.md,
  },
  headerText: { flex: 1, minWidth: 0, gap: tokens.space.hair },
  title: { marginTop: tokens.space.hair },
  titlePress: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  titlePressed: { opacity: 0.7 },
  meta: { marginTop: tokens.space.xs },
  iconBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    marginTop: tokens.space.hair,
  },
  iconBtnPressed: { backgroundColor: tokens.bg.raised },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: {
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.md,
  },
});
