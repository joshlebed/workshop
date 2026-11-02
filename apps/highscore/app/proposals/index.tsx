// Dev-only: profile / friends UX proposals. Not linked from the app.
import { type Href, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { PROPOSALS } from "../../src/proposals/report";
import { PixelIcon, Screen, Text, tokens } from "../../src/theme";

export default function ProposalsIndex() {
  const router = useRouter();
  return (
    <Screen testID="proposals-index">
      <ScrollView contentContainerStyle={styles.body}>
        <Text variant="overline" tone="secondary">
          HighScore · profile menu proposals
        </Text>
        <Text variant="title">Three ways to replace the profile sheet</Text>
        <Text tone="secondary">
          Each opens an interactive mock on your real data. Tap one, then use the switcher at the
          top to compare.
        </Text>
        {PROPOSALS.map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            onPress={() => router.push(`/proposals/${p.id}` as Href)}
            style={({ pressed, hovered }) => [
              styles.card,
              (pressed || hovered) && styles.cardHover,
            ]}
            testID={`proposal-${p.id}`}
          >
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Text variant="heading">{p.name}</Text>
              <Text tone="secondary">{p.tagline}</Text>
            </View>
            <PixelIcon name="chevron-right" size={24} color={tokens.neon.pink} />
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: tokens.space.lg, gap: tokens.space.md, paddingBottom: tokens.space.xxl },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    padding: tokens.space.lg,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  cardHover: { backgroundColor: tokens.bg.surface },
});
