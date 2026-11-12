import { Badge, IconButton, tokens } from "@workshop/ui";
import { Platform, StyleSheet, View } from "react-native";

export interface HeaderActivityButtonProps {
  unreadCount: number;
  error?: boolean;
  onPress: () => void;
  onRetry?: () => void;
  testID?: string;
}

/** Home header bell (3.6): opens Activity; the badge is the server-authored unread sum. */
export function HeaderActivityButton({
  unreadCount,
  error = false,
  onPress,
  onRetry,
  testID = "open-activity",
}: HeaderActivityButtonProps) {
  const hasUnread = unreadCount > 0;
  const label = error
    ? "Activity couldn't load. Try again"
    : hasUnread
      ? `Activity, ${unreadCount} new`
      : "Activity";

  return (
    <View>
      <IconButton
        icon="bell"
        iconTone={hasUnread ? "primary" : "secondary"}
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
      />
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
          accessibilityLabel="Activity couldn't load"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { position: "absolute", top: tokens.space.xxs, right: 0, pointerEvents: "none" },
});
