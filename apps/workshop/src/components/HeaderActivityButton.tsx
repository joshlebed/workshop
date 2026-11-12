import { Badge, tokens } from "@workshop/ui";
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
      style={styles.target}
    >
      {({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => (
        <View style={[styles.button, hovered && styles.hovered, pressed && styles.pressed]}>
          <ActivityGlyph unread={hasUnread} error={error} />
          {hasUnread && !error ? (
            <Badge
              label={unreadCount > 9 ? "9+" : String(unreadCount)}
              tone="accent"
              ringColor={tokens.bg.canvas}
              style={styles.badge}
              testID="activity-unread-badge"
            />
          ) : null}
          {error ? (
            <Badge
              label="!"
              tone="danger"
              ringColor={tokens.bg.canvas}
              style={styles.badge}
              accessibilityLabel="Activity load failed"
            />
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // 44pt press target around the 40pt disc (web ignores hitSlop).
  target: {
    width: tokens.hit,
    height: tokens.hit,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.pill,
  },
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
  hovered: { borderColor: tokens.border.default },
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
  badge: { position: "absolute", top: -4, right: -4 },
});
