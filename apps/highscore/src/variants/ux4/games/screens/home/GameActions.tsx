// The per-game actions that used to hide behind a kebab on every card. A row
// of three dots per game is the laziest affordance in mobile design and it was
// costing 28pt of the densest row in the app; these now live at the bottom of
// the game's peek, which you are already holding the row to see.

import { Pressable, StyleSheet, View } from "react-native";
import { PixelIcon, type PixelIconName, Text, tokens } from "../../../theme";

interface GameActionsProps {
  onOpenGame: () => void;
  onReteach?: () => void;
  onRemove: () => void;
}

export function GameActions({ onOpenGame, onReteach, onRemove }: GameActionsProps) {
  return (
    <View style={styles.row}>
      <Action icon="external-link" label="Open" onPress={onOpenGame} testID="peek-open-game" />
      {onReteach ? (
        <Action icon="pencil" label="Re-teach" onPress={onReteach} testID="peek-reteach" />
      ) : null}
      <Action
        icon="trash"
        label="Remove"
        onPress={onRemove}
        tone={tokens.status.danger}
        testID="peek-remove-game"
      />
    </View>
  );
}

function Action({
  icon,
  label,
  onPress,
  tone = tokens.text.secondary,
  testID,
}: {
  icon: PixelIconName;
  label: string;
  onPress: () => void;
  tone?: string;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      <PixelIcon name={icon} size={16} color={tone} />
      <Text variant="caption" style={{ color: tone }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: tokens.space.sm,
    paddingTop: tokens.space.sm,
    marginTop: tokens.space.xs,
    borderTopWidth: tokens.bezel,
    borderTopColor: tokens.border.default,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
    minHeight: 32,
    paddingHorizontal: tokens.space.xs,
  },
  pressed: { opacity: 0.6 },
});
