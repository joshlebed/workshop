import { IconButton, tokens } from "@workshop/ui";
import { StyleSheet, View } from "react-native";
import type { RowMoreButtonProps } from "./RowMoreButton";

/**
 * Web: a trailing "more" button over the right end of the home row. It is
 * always in the tab order (so Tab from the row reaches it) and shows while the
 * row or the button is hovered or focused. Touch browsers never hover, so on a
 * phone the row's long-press opens the same menu.
 */
export function RowMoreButton({
  visible,
  label,
  onPress,
  onActiveChange,
  testID,
}: RowMoreButtonProps) {
  return (
    <View style={[styles.slot, visible ? styles.shown : styles.hidden]} pointerEvents="box-none">
      <IconButton
        icon="more"
        iconTone="secondary"
        accessibilityLabel={label}
        onPress={onPress}
        onHoverIn={() => onActiveChange("hover", true)}
        onHoverOut={() => onActiveChange("hover", false)}
        onFocus={() => onActiveChange("focus", true)}
        onBlur={() => onActiveChange("focus", false)}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: tokens.space.xs + tokens.space.xs,
    justifyContent: "center",
  },
  shown: { opacity: 1 },
  hidden: { opacity: 0 },
});
