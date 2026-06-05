import { LIST_TEMPLATES } from "@workshop/shared/templates";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { goBack } from "../../src/lib/goBack";
import { IconButton, type ListColorKey, Screen, Text, tokens } from "../../src/ui/index";

export default function CreateListType() {
  const router = useRouter();

  return (
    <Screen style={styles.root}>
      <View style={styles.header}>
        <IconButton
          accessibilityLabel="Cancel"
          onPress={() => goBack("/")}
          testID="create-list-cancel"
        >
          <Text style={styles.backGlyph}>✕</Text>
        </IconButton>
        <View style={styles.stepDots} accessibilityLabel="Step 1 of 2">
          <View style={[styles.stepDot, styles.stepDotActive]} />
          <View style={styles.stepDot} />
        </View>
        <View style={styles.headerSpacer} />
      </View>

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
          {LIST_TEMPLATES.map((tpl) => {
            const accent = tokens.list[tpl.defaults.color as ListColorKey];
            return (
              <Pressable
                key={tpl.id}
                testID={`create-list-template-${tpl.id}`}
                accessibilityRole="button"
                accessibilityLabel={tpl.displayName}
                onPress={() =>
                  router.push({
                    pathname: "/create-list/customize",
                    params: { template: tpl.id },
                  })
                }
                style={({
                  pressed,
                  hovered,
                  focused,
                }: {
                  pressed?: boolean;
                  hovered?: boolean;
                  focused?: boolean;
                }) => [
                  styles.option,
                  hovered && styles.optionHovered,
                  focused && styles.optionFocused,
                  pressed && styles.optionPressed,
                ]}
              >
                <View
                  style={[
                    styles.optionBadge,
                    { backgroundColor: `${accent}26`, borderColor: `${accent}3D` },
                  ]}
                >
                  <Text style={styles.optionEmoji}>{tpl.defaults.emoji}</Text>
                </View>
                <View style={styles.optionText}>
                  <Text variant="label" style={styles.optionLabel}>
                    {tpl.displayName}
                  </Text>
                  <Text variant="caption" tone="muted" numberOfLines={2}>
                    {tpl.description}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.xl,
    paddingBottom: tokens.space.md,
  },
  stepDots: { flexDirection: "row", gap: 6, alignItems: "center" },
  stepDot: {
    width: 18,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: tokens.border.subtle,
  },
  stepDotActive: { backgroundColor: tokens.accent.default },
  backGlyph: { color: tokens.text.primary, fontSize: tokens.font.size.lg },
  headerSpacer: { width: 40 },
  body: {
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.xl,
  },
  intro: { gap: tokens.space.xs, paddingHorizontal: tokens.space.sm },
  lead: { letterSpacing: -0.4 },
  options: { gap: tokens.space.xs },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.sm,
    borderRadius: tokens.radius.lg,
  },
  optionHovered: { backgroundColor: tokens.bg.surface },
  optionFocused: {
    backgroundColor: tokens.bg.surface,
    outlineWidth: 0,
    boxShadow: `0 0 0 1.5px ${tokens.accent.default}`,
  },
  optionPressed: { backgroundColor: tokens.bg.elevated },
  optionBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  optionEmoji: { fontSize: 26, lineHeight: 30 },
  optionText: { flex: 1, gap: 3, minWidth: 0 },
  optionLabel: { fontSize: tokens.font.size.md },
});
