import { StyleSheet, View } from "react-native";
import { Text } from "./Text";
import { tokens } from "./tokens";

export interface NoticeProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  testID?: string;
}

/**
 * What used to be an empty state. Left-aligned and tight on purpose: a
 * centered block floating in a screen of nothing reads as a placeholder, and
 * this app never has a screen of nothing.
 */
export function Notice({ title, description, action, testID }: NoticeProps) {
  return (
    <View style={styles.root} testID={testID}>
      <Text variant="title" style={styles.title}>
        {title}
      </Text>
      {description ? (
        <Text variant="caption" tone="muted">
          {description}
        </Text>
      ) : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: tokens.space.sm, paddingVertical: tokens.space.lg },
  title: { fontSize: 13, lineHeight: 20 },
  action: { alignItems: "flex-start", paddingTop: tokens.space.xs },
});
