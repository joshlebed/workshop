// Web-only "Open in app" card for the play-link landing, shown when the page is
// opened inside a third-party in-app browser (Messenger / Instagram), where iOS
// can't auto-open the native app from a Universal Link.
//
// The CTA is a REAL `<a href>` on purpose: iOS only routes a Universal Link to
// the installed app on a genuine *user tap* on a link element — a programmatic
// `window.location = …` / `Linking.openURL(…)` inside the WebView does nothing
// (Apple's documented behavior). `url` must be the https Universal Link
// (`…/g/<token>`), never `workshop://`: tapping the https link opens the app if
// installed and just loads the web page if not — no "Cannot Open Page" dialog.
//
// Meta's in-app browser is sometimes engineered to suppress even the tap, so the
// card always pairs the button with a "⋯ → Open in Safari" hint (Universal Links
// fire reliably from real Safari) and a "continue here" escape.

import type { CSSProperties } from "react";
import { StyleSheet, View } from "react-native";
import { Button, Card, Text, tokens } from "../ui/index";
import type { OpenInAppCardProps } from "./OpenInAppCard";

export type { OpenInAppCardProps } from "./OpenInAppCard";

const anchorStyle: CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  backgroundColor: tokens.accent.default,
  color: tokens.text.onAccent,
  textDecoration: "none",
  textAlign: "center",
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
          This link opened in an in-app browser, which can't hand off to the app on its own. Tap to
          continue in Workshop.
        </Text>
      </View>

      {/* Real anchor — a user tap on this https Universal Link is the only thing
          iOS will route to the installed app from inside an in-app browser. */}
      <a href={url} style={anchorStyle} data-testid="open-in-app-link">
        Open Workshop
      </a>

      <Text tone="muted" variant="caption" style={styles.hint}>
        Nothing happened? Tap the ⋯ menu and choose “Open in Safari,” then reopen the link.
      </Text>

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
  hint: { textAlign: "center" },
});
