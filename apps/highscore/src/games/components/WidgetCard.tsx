// "Add the HighScore widget" on Games home, after the first score: iOS 1.4.0+
// only, once per account (`games.widget-card`), and never while the
// share-sheet card is up. Gone for good on X / "Got it", or as soon as a
// widget is known to be on the home screen (`games.widget-installed`).
// Rules: src/lib/widgetSnapshot.ts; state: src/hooks/useWidgetCard.ts.

import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WidgetHowTo } from "../../components/WidgetHowTo";
import { useWidgetCard } from "../../hooks/useWidgetCard";
import { Button, IconButton, PixelIcon, Text, tokens } from "../../theme";

export function WidgetCard({
  hasPosted,
  otherCardVisible,
}: {
  hasPosted: boolean;
  otherCardVisible: boolean;
}) {
  const { visible, markShown, dismiss } = useWidgetCard({ hasPosted, otherCardVisible });
  // card_shown once per mount, the first time it renders.
  const shownRef = useRef(false);
  useEffect(() => {
    if (!visible || shownRef.current) return;
    shownRef.current = true;
    markShown();
  }, [visible, markShown]);
  if (!visible) return null;
  return (
    <View style={styles.card} testID="widget-card" accessibilityRole="summary">
      <View style={styles.head}>
        <View style={styles.copy}>
          <Text variant="label">Add the HighScore widget</Text>
          <Text variant="caption" tone="secondary">
            See which friends have played today without opening the app.
          </Text>
        </View>
        <IconButton
          accessibilityLabel="Dismiss widget tip"
          onPress={dismiss}
          testID="widget-card-dismiss"
        >
          <PixelIcon name="close" size={16} color={tokens.text.secondary} />
        </IconButton>
      </View>
      <WidgetHowTo testID="widget-card-steps" />
      <Button label="Got it" size="md" onPress={dismiss} testID="widget-card-done" />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: tokens.space.md,
    marginHorizontal: tokens.space.lg,
    marginBottom: tokens.space.sm,
    padding: tokens.space.md,
    borderWidth: tokens.bezel,
    borderColor: tokens.accent.default,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.surface,
  },
  head: { flexDirection: "row", alignItems: "flex-start", gap: tokens.space.sm },
  copy: { flex: 1, minWidth: 0, gap: 2 },
});
