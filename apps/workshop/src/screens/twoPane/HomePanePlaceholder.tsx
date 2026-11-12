import { Button, Icon, Screen, Text, tokens } from "@workshop/ui";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { ShortcutKeys } from "../../components/KeyboardShortcutsSheet";

/**
 * The right pane of the desktop two-pane layout when no list is open
 * (5.7c). The lists are in the sidebar, so this says what to do next and
 * where the keyboard shortcuts live, and nothing else.
 */
export function HomePanePlaceholder() {
  const router = useRouter();
  return (
    <Screen testID="home-pane-placeholder">
      <View style={styles.center}>
        {/* The page's level-1 heading on desktop (the sidebar's "Lists" is 2). */}
        <Text variant="heading" headerRole={1} style={styles.text}>
          Open a list
        </Text>
        <Text tone="secondary" style={styles.text}>
          Pick one on the left, or start a new one.
        </Text>
        <Button
          label="New list"
          variant="secondary"
          leftIcon={<Icon name="plus" size={16} tone="primary" />}
          onPress={() => router.push("/create-list/type")}
          testID="pane-create-list"
          style={styles.action}
        />
        <View style={styles.hint}>
          <Text variant="caption" tone="muted">
            Press
          </Text>
          <ShortcutKeys keys={["?"]} />
          <Text variant="caption" tone="muted">
            for keyboard shortcuts
          </Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.xl,
  },
  text: { textAlign: "center" },
  action: { marginTop: tokens.space.md },
  hint: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xsm,
    marginTop: tokens.space.xl,
  },
});
