import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { IconButton } from "./IconButton";
import { Text } from "./Text";
import { tokens } from "./theme";

export interface ScreenHeaderProps {
  /**
   * `back` for destinations (pushed screens), `close` for flows that create
   * or edit something (modals; the commit action goes in `trailing`), `none`
   * for roots. The leading control always sits on the left.
   */
  leading?: "back" | "close" | "none";
  /** Required unless `leading="none"`. Shared code never hardcodes a route. */
  onLeadingPress?: () => void;
  /** Accessible name for the leading control. Defaults to "Back" / "Close". */
  leadingLabel?: string;
  leadingTestID?: string;
  title?: string;
  /** Small tracked kicker above the title ("Settings", "Account"). */
  eyebrow?: string;
  /** Rendered just before the title block (an `EmojiBadge`, an avatar). */
  titleAccessory?: ReactNode;
  /** Right-hand actions: `IconButton`s, or the commit `Button` of a flow. */
  trailing?: ReactNode;
  /** Replaces the title block entirely (step dots, a custom control). */
  center?: ReactNode;
  style?: ViewStyle;
  testID?: string;
}

/**
 * The one screen header. One top padding, one title style (`heading`, left
 * aligned after the leading control), a 44pt leading control and a trailing
 * slot. Screens with a large in-body title (list detail) pass no `title`.
 */
export function ScreenHeader({
  leading = "back",
  onLeadingPress,
  leadingLabel,
  leadingTestID,
  title,
  eyebrow,
  titleAccessory,
  trailing,
  center,
  style,
  testID,
}: ScreenHeaderProps) {
  const hasLeading = leading !== "none";
  return (
    <View style={[styles.root, style]} testID={testID}>
      {hasLeading ? (
        <IconButton
          icon={leading === "back" ? "back" : "close"}
          // 24 for back (a chevron reads light at 20 beside an 18pt title); 20 for close.
          iconSize={leading === "back" ? 24 : 20}
          accessibilityLabel={leadingLabel ?? (leading === "back" ? "Back" : "Close")}
          onPress={onLeadingPress}
          testID={leadingTestID}
        />
      ) : null}
      <View style={[styles.middle, !hasLeading && styles.middleNoLeading]}>
        {center ?? (
          <>
            {titleAccessory}
            {title || eyebrow ? (
              <View style={styles.titleBlock}>
                {eyebrow ? (
                  <Text variant="eyebrow" numberOfLines={1}>
                    {eyebrow}
                  </Text>
                ) : null}
                {title ? (
                  <Text variant="heading" numberOfLines={1} headerRole>
                    {title}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </>
        )}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
    minHeight: 56,
    paddingTop: tokens.space.sm,
    paddingHorizontal: tokens.space.sm,
  },
  middle: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
  },
  middleNoLeading: { paddingLeft: tokens.space.sm },
  titleBlock: { flex: 1, minWidth: 0 },
  trailing: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
});
