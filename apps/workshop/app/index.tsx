import { StyleSheet, View } from "react-native";
import { useAuth } from "../src/hooks/useAuth";
import { Button, EmptyState, Text, tokens } from "../src/ui/index";

export default function Home() {
  const { user, signOut } = useAuth();

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text variant="heading">Workshop.dev</Text>
        <Text tone="secondary" testID="home-greeting">
          {user?.displayName ? `Signed in as ${user.displayName}` : "Signed in"}
        </Text>
      </View>

      <View style={styles.body}>
        <EmptyState
          title="No lists yet"
          description="Lists, items, and sharing land in Phase 1. This is the signed-in home placeholder."
        />
      </View>

      <View style={styles.footer}>
        <Button testID="sign-out" label="Sign out" variant="ghost" onPress={signOut} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.xxl,
    paddingBottom: tokens.space.xl,
    gap: tokens.space.xl,
  },
  header: { gap: tokens.space.xs },
  body: { flex: 1, alignItems: "center", justifyContent: "center" },
  footer: { alignItems: "center" },
});
