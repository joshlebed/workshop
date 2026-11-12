import { Button, Screen, Text, tokens } from "@workshop/ui";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

/** Unknown routes (`/friends`, a mistyped link): one sentence and a way home (3.8). */
export default function NotFound() {
  const router = useRouter();
  return (
    <Screen style={styles.root} testID="not-found">
      <View style={styles.body}>
        <Text variant="heading" headerRole style={styles.text}>
          There’s nothing at this address.
        </Text>
        <Button
          label="Back to lists"
          size="lg"
          onPress={() => router.replace("/")}
          testID="not-found-home"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.lg,
    paddingHorizontal: tokens.space.xl,
  },
  text: { textAlign: "center" },
});
