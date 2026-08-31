// Shared shell for HighScore's public pages (`/support`, `/privacy`).
//
// These render for signed-out visitors — App Store reviewers, anyone following
// the published support/privacy URLs — so the shell stays self-contained: no
// auth, no queries, nothing that can fail. `Screen` gives the web reading
// column; the wordmark doubles as the way back into the app.

import { openExternalUrl, Screen } from "@workshop/ui";
import { goBack } from "@workshop/ui/navigation";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Wordmark } from "../../components/Wordmark";
import type { LegalSection } from "../../lib/legal";
import { Button, bezel, colors, radius, space, Text } from "../../theme";

interface LegalScreenProps {
  eyebrow: string;
  title: string;
  intro: string;
  effectiveDate?: string;
  sections: LegalSection[];
  contactLabel: string;
  contactUrl: string;
  footnote?: string;
  testID: string;
}

export function LegalScreen({
  eyebrow,
  title,
  intro,
  effectiveDate,
  sections,
  contactLabel,
  contactUrl,
  footnote,
  testID,
}: LegalScreenProps) {
  return (
    <Screen style={styles.root} testID={testID}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Back to HighScore"
          onPress={() => goBack("/")}
          testID={`${testID}-home`}
          style={({ pressed }) => [styles.homeLink, pressed && styles.pressed]}
        >
          <Wordmark />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        testID={`${testID}-scroll`}
      >
        <View style={styles.titleBlock}>
          <Text variant="caption" tone="muted" style={styles.eyebrow}>
            {eyebrow}
          </Text>
          <Text variant="title" accessibilityRole="header">
            {title}
          </Text>
          <Text tone="secondary">{intro}</Text>
          {effectiveDate ? (
            <Text variant="caption" tone="muted" testID={`${testID}-effective-date`}>
              Effective {effectiveDate}
            </Text>
          ) : null}
        </View>

        {sections.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text variant="heading">{section.heading}</Text>
            {section.body?.map((paragraph) => (
              <Text key={paragraph} tone="secondary">
                {paragraph}
              </Text>
            ))}
            {section.bullets?.map((bullet) => (
              <View key={bullet} style={styles.bulletRow}>
                <Text tone="muted" style={styles.bulletGlyph}>
                  •
                </Text>
                <Text tone="secondary" style={styles.bulletText}>
                  {bullet}
                </Text>
              </View>
            ))}
          </View>
        ))}

        <Button
          label={contactLabel}
          size="lg"
          testID={`${testID}-contact`}
          onPress={() => openExternalUrl(contactUrl)}
        />

        {footnote ? (
          <Text variant="caption" tone="muted" style={styles.footnote}>
            {footnote}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.md,
  },
  homeLink: { borderRadius: radius.none },
  pressed: { opacity: 0.6 },
  body: {
    paddingHorizontal: space.lg,
    paddingBottom: space.xxl * 2,
    gap: space.lg,
  },
  titleBlock: { gap: space.sm },
  eyebrow: { letterSpacing: 0.4, textTransform: "uppercase" },
  section: {
    gap: space.sm,
    backgroundColor: colors.surface1,
    borderWidth: bezel,
    borderColor: colors.border,
    borderRadius: radius.soft,
    padding: space.lg,
  },
  bulletRow: { flexDirection: "row", gap: space.sm },
  bulletGlyph: { lineHeight: 22 },
  bulletText: { flex: 1 },
  footnote: { textAlign: "center" },
});
