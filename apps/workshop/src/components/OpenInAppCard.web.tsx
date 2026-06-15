// Web-only "Open in app" card for the play-link landing, shown when the page is
// opened inside a third-party in-app browser (Messenger / Instagram).
//
// The CTA is a REAL `<a href>` (a genuine user tap, not a programmatic
// navigation) pointing at the app's **custom scheme** `workshop://…`, NOT the
// https Universal Link. Why the scheme and not the Universal Link:
//   - The Universal Link is the *same* https URL the page is already on, so a
//     tap just reloads it (Apple won't fire a Universal Link to the same domain
//     you're already viewing) → an endless in-app-browser loop. The custom
//     scheme is not an http navigation, so it never reloads the page.
//   - The scheme is registered by the app's Info.plist (`CFBundleURLSchemes`),
//     so iOS routes it to the installed app regardless of AASA / Universal Link
//     association state — which, for this app, is exactly what's failing (links
//     don't reliably open the app even from iMessage).
// Tradeoff: tapping a custom scheme with the app NOT installed shows iOS's
// "Cannot Open Page" alert — acceptable for a TestFlight app, and "Continue
// here instead" is the web fallback for anyone without it.
//
// The `<a>` also needs an explicit `fontFamily`: a raw DOM element doesn't
// inherit RN-Web's injected text font, so without this it renders in the UA
// serif (Times). The value mirrors RN-Web's default `Text` stack exactly.

import type { CSSProperties } from "react";
import { StyleSheet, View } from "react-native";
import { Button, Card, Text, tokens } from "../ui/index";
import type { OpenInAppCardProps } from "./OpenInAppCard";

export type { OpenInAppCardProps } from "./OpenInAppCard";

// RN-Web's default Text font stack — keep in sync so the anchor matches the card.
const SYSTEM_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const anchorStyle: CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  backgroundColor: tokens.accent.default,
  color: tokens.text.onAccent,
  textDecoration: "none",
  textAlign: "center",
  fontFamily: SYSTEM_FONT,
  fontSize: tokens.font.size.md,
  fontWeight: tokens.font.weight.semibold,
  paddingTop: tokens.space.md,
  paddingBottom: tokens.space.md,
  borderRadius: tokens.radius.md,
};

export function OpenInAppCard({ url, onContinue }: OpenInAppCardProps) {
  return (
    <Card style={styles.card} elevated>
      <View style={styles.header}>
        <Text style={styles.glyph}>🎮</Text>
        <Text variant="title" style={styles.title}>
          Open in the Workshop app
        </Text>
        <Text tone="secondary" style={styles.body}>
          Tap below to jump to the app — or keep going here in your browser.
        </Text>
      </View>

      {/* Real anchor → the app's custom scheme. A user tap opens the installed
          app directly (no Universal Link / reload loop). */}
      <a href={url} style={anchorStyle} data-testid="open-in-app-link">
        Open Workshop
      </a>

      <Button
        label="Continue here instead"
        variant="ghost"
        onPress={onContinue}
        testID="open-in-app-continue"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: tokens.space.md,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  header: { alignItems: "center", gap: tokens.space.sm },
  glyph: { fontSize: 40, lineHeight: 46 },
  title: { textAlign: "center" },
  body: { textAlign: "center" },
});
