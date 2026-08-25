import { Text, tokens } from "@workshop/ui";
import { Platform, Pressable, StyleSheet, View } from "react-native";

export interface HeaderActivityButtonProps {
  unreadCount: number;
  error?: boolean;
  onPress: () => void;
  onRetry?: () => void;
  testID?: string;
}

// Activity affordance: three stacked horizontal bars of decreasing length,
// drawn from Views. Reads as "feed" / "list of recent things" without a
// dependency on an icon library, and stays calm at 16px.
function ActivityGlyph({ unread, error }: { unread: boolean; error?: boolean }) {
  const color = error ? tokens.text.muted : unread ? tokens.text.primary : tokens.text.secondary;
  return (
    <View style={styles.activityGlyph} pointerEvents="none">
      <View style={[styles.activityBar, { backgroundColor: color, width: 14 }]} />
      <View style={[styles.activityBar, { backgroundColor: color, width: 10 }]} />
      <View style={[styles.activityBar, { backgroundColor: color, width: 6 }]} />
    </View>
  );
}

export function HeaderActivityButton({
  unreadCount,
  error = false,
  onPress,
  onRetry,
  testID = "open-activity",
}: HeaderActivityButtonProps) {
  const hasUnread = unreadCount > 0;
  const label = error
    ? "Activity (couldn't load, tap to retry)"
    : hasUnread
      ? `Activity, ${unreadCount} new`
      : "Activity";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        if (error && onRetry) {
          onRetry();
          return;
        }
        onPress();
      }}
      // @ts-expect-error: react-native-web threads native title through to <button title>
      title={Platform.OS === "web" ? "Activity  (⌘/)" : undefined}
      testID={testID}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <ActivityGlyph unread={hasUnread} error={error} />
      {hasUnread && !error ? (
        <View style={styles.unreadBadge} testID="activity-unread-badge">
          <Text style={styles.unreadBadgeText} tone="onAccent">
            {unreadCount > 9 ? "9+" : String(unreadCount)}
          </Text>
        </View>
      ) : null}
      {error ? (
        <View
          style={[styles.unreadBadge, { backgroundColor: tokens.status.danger }]}
          accessibilityLabel="Activity load failed"
        >
          <Text style={styles.unreadBadgeText} tone="onAccent">
            !
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.surface,
  },
  pressed: { backgroundColor: tokens.bg.elevated },
  activityGlyph: {
    gap: 3,
    alignItems: "flex-start",
    width: 14,
    height: 13,
    justifyContent: "center",
  },
  activityBar: {
    height: 1.5,
    borderRadius: 1,
  },
  unreadBadge: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: tokens.accent.default,
    borderWidth: 2,
    borderColor: tokens.bg.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadBadgeText: {
    fontSize: 10,
    fontWeight: tokens.font.weight.bold,
    lineHeight: 12,
    letterSpacing: 0.1,
  },
});
