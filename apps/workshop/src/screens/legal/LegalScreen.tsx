import {
  Button,
  layout,
  Screen,
  ScreenHeader,
  screenColumnStyle,
  Text,
  tokens,
} from "@workshop/ui";
import { Linking, ScrollView, StyleSheet, View } from "react-native";
import { goBack } from "../../lib/goBack";
import type { LegalSection } from "../../lib/legal";

/**
 * Shell for Workshop's public pages, `/privacy` and `/terms` (4.5). They
 * render signed out (App Review, anyone following a link), so nothing here
 * can fail: no auth, no queries.
 */
export function LegalScreen({
  title,
  intro,
  effectiveDate,
  sections,
  contactLabel,
  contactUrl,
  testID,
}: {
  title: string;
  intro: string;
  effectiveDate: string;
  sections: LegalSection[];
  contactLabel: string;
  contactUrl: string;
  testID: string;
}) {
  return (
    <Screen style={styles.root} testID={testID}>
      <ScreenHeader
        leading="back"
        onLeadingPress={() => goBack("/")}
        leadingTestID={`${testID}-back`}
        title={title}
      />
      <ScrollView contentContainerStyle={[styles.body, screenColumnStyle]}>
        <Text tone="secondary" style={styles.intro}>
          {intro}
        </Text>
        <Text variant="caption" tone="muted">
          Effective {effectiveDate}
        </Text>
        {sections.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text variant="heading">{section.heading}</Text>
            {section.body?.map((p) => (
              <Text key={p} tone="secondary" style={styles.paragraph}>
                {p}
              </Text>
            ))}
            {section.bullets?.map((b) => (
              <View key={b} style={styles.bullet}>
                <View style={styles.bulletDot} />
                <Text tone="secondary" style={styles.bulletText}>
                  {b}
                </Text>
              </View>
            ))}
          </View>
        ))}
        <View style={styles.contact}>
          <Button
            label={contactLabel}
            variant="secondary"
            onPress={() => void Linking.openURL(contactUrl).catch(() => {})}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  body: {
    paddingHorizontal: layout.gutter,
    paddingTop: tokens.space.sm,
    paddingBottom: layout.bottomInset,
    gap: tokens.space.md,
  },
  intro: { fontSize: tokens.font.size.lg, lineHeight: tokens.font.lineHeight.lg },
  section: { gap: tokens.space.sm, marginTop: tokens.space.lg },
  // Long-form reading text takes the next line-height step for air.
  paragraph: { lineHeight: tokens.font.lineHeight.lg },
  bullet: { flexDirection: "row", gap: tokens.space.md, alignItems: "flex-start" },
  // Centred on the first 24pt line: (24 - 8) / 2 = 8.
  bulletDot: {
    width: 8,
    height: 8,
    borderRadius: tokens.radius.pill,
    marginTop: tokens.space.sm,
    backgroundColor: tokens.text.muted,
  },
  bulletText: { flex: 1, lineHeight: tokens.font.lineHeight.lg },
  contact: { marginTop: tokens.space.xl, alignItems: "flex-start" },
});
