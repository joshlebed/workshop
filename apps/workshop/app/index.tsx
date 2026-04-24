import { StyleSheet, Text, View } from "react-native";

export default function Home() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Workshop.dev</Text>
      <Text style={styles.subtitle}>v2 is being rebuilt.</Text>
      <Text style={styles.body}>
        Sign-in and lists land in the next chunks. See docs/redesign-plan.md for the rollout order.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    backgroundColor: "#0a1931",
    gap: 16,
  },
  title: { color: "#F2F2F5", fontSize: 32, fontWeight: "700" },
  subtitle: { color: "#A8A8B3", fontSize: 18 },
  body: { color: "#6E6E78", fontSize: 14, textAlign: "center", maxWidth: 480 },
});
