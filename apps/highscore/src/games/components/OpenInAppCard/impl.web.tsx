// Web fallback when the source app keeps a share link in its own browser.
// Try the iOS scheme once on arrival; keep a real anchor for browsers that
// require a user gesture. A same-domain HTTPS link could just reload this page.

import { type CSSProperties, useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Button, Card, SECONDARY_FONT, Text, tokens } from "../../../theme";
import { scheduleAppOpen, watchAppOpen } from "../../lib/appHandoff";
import { canAutoOpenApp } from "../../lib/inAppBrowser";
import type { OpenInAppCardProps } from "./impl";

export type { OpenInAppCardProps } from "./impl";

// Theme button face first, then RN-Web's default stack as the fallback.
const BUTTON_FONT = `"${SECONDARY_FONT.semibold}", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

// Mirrors the theme `Button` primary variant (neon sign: transparent fill,
// pink 2px bezel, pink label, pink glow) on a raw DOM anchor.
const anchorStyle: CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  backgroundColor: "transparent",
  color: tokens.neon.pink,
  textDecoration: "none",
  textAlign: "center",
  fontFamily: BUTTON_FONT,
  fontSize: tokens.font.size.md,
  paddingTop: tokens.space.md,
  paddingBottom: tokens.space.md,
  borderRadius: tokens.radius.sm,
  borderWidth: tokens.bezel,
  borderStyle: "solid",
  borderColor: tokens.neon.pink,
  boxShadow: `0 0 10px ${tokens.neon.pinkGlow}`,
};

export function OpenInAppCard({ appName, url, onContinue }: OpenInAppCardProps) {
  const cancelAttempt = useRef<(() => void) | null>(null);
  const autoOpen = canAutoOpenApp();

  useEffect(() => {
    if (autoOpen) cancelAttempt.current = scheduleAppOpen(url);
    return () => cancelAttempt.current?.();
  }, [url, autoOpen]);

  const continueOnWeb = () => {
    cancelAttempt.current?.();
    onContinue();
  };

  // Don't preventDefault: the anchor itself preserves the user gesture.
  const onOpenTap = () => {
    cancelAttempt.current?.();
    cancelAttempt.current = watchAppOpen(onContinue);
  };

  return (
    <Card style={styles.card} elevated>
      <View style={styles.header}>
        <Text style={styles.glyph}>🎮</Text>
        <Text variant="title" style={styles.title}>
          Open in {appName}
        </Text>
        <Text tone="secondary" style={styles.body}>
          {autoOpen
            ? `If ${appName} doesn’t open automatically, tap below or continue in your browser.`
            : "Tap below to open the app, or continue in your browser."}
        </Text>
      </View>

      {/* Real anchor → the app's custom scheme. A user tap opens the installed
          app directly (no Universal Link / reload loop); `onOpenTap` arms the
          web fallback for anyone without the app. */}
      <a href={url} style={anchorStyle} onClick={onOpenTap} data-testid="open-in-app-link">
        Open {appName}
      </a>

      <Button
        label="Continue here instead"
        variant="ghost"
        onPress={continueOnWeb}
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
