import { LIST_TEMPLATES } from "@workshop/shared/templates";
import {
  EmojiBadge,
  type ListColorKey,
  ListRow,
  Screen,
  ScreenHeader,
  Text,
  tokens,
} from "@workshop/ui";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { goBack } from "../../../../src/lib/goBack";

export default function CreateListType() {
  const router = useRouter();

  return (
    <Screen style={styles.root}>
      <ScreenHeader
        leading="close"
        onLeadingPress={() => goBack("/")}
        leadingLabel="Cancel"
        leadingTestID="create-list-cancel"
        center={
          <View style={styles.stepDots} accessibilityLabel="Step 1 of 2">
            <View style={[styles.stepDot, styles.stepDotActive]} />
            <View style={styles.stepDot} />
          </View>
        }
        trailing={<View style={styles.headerSpacer} />}
      />

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.intro}>
          <Text variant="title" style={styles.lead}>
            Pick a template
          </Text>
          <Text variant="caption" tone="muted">
            Templates are starting points. You can change anything later.
          </Text>
        </View>
        <View style={styles.options}>
          {LIST_TEMPLATES.map((tpl) => (
            <ListRow
              key={tpl.id}
              testID={`create-list-template-${tpl.id}`}
              accessibilityLabel={tpl.displayName}
              onPress={() =>
                router.push({
                  pathname: "/create-list/customize",
                  params: { template: tpl.id },
                })
              }
              leading={
                <EmojiBadge
                  emoji={tpl.defaults.emoji}
                  color={tokens.list[tpl.defaults.color as ListColorKey]}
                />
              }
              title={tpl.displayName}
              subtitle={
                <Text variant="caption" tone="muted" numberOfLines={2}>
                  {tpl.description}
                </Text>
              }
            />
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  stepDots: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    gap: tokens.space.xsm,
    alignItems: "center",
  },
  stepDot: {
    width: 18,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: tokens.border.subtle,
  },
  stepDotActive: { backgroundColor: tokens.accent.default },
  // Balances the leading close button so the step dots sit centred.
  headerSpacer: { width: tokens.hit },
  body: {
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.xl,
  },
  intro: { gap: tokens.space.xs, paddingHorizontal: tokens.space.sm },
  lead: { letterSpacing: -0.4 },
  // Rows bring their own inset; pull them out so badges align with the intro.
  options: { gap: tokens.space.xs, marginHorizontal: -tokens.space.sm },
});
