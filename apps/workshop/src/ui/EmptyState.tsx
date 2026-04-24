import { StyleSheet, View } from "react-native";
import { Text } from "./Text";
import { tokens } from "./theme";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <View style={styles.root}>
      <Text variant="heading" style={styles.title}>
        {title}
      </Text>
      {description ? (
        <Text tone="secondary" style={styles.description}>
          {description}
        </Text>
      ) : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: tokens.space.xl,
    gap: tokens.space.md,
  },
  title: { textAlign: "center" },
  description: { textAlign: "center", maxWidth: 420 },
  action: { marginTop: tokens.space.lg },
});
