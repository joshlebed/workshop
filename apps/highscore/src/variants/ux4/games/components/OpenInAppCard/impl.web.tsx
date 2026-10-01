// Web-only "Open in app" card for the play-link landing, shown when the page is
// opened inside a third-party in-app browser (Messenger / Instagram).
//
// The CTA is a REAL `<a href>` (a genuine user tap, not a programmatic
// navigation) pointing at the host app's **custom scheme**, NOT the
// https Universal Link. Why the scheme and not the Universal Link:
//   - The Universal Link is the *same* https URL the page is already on, so a
//     tap just reloads it (Apple won't fire a Universal Link to the same domain
//     you're already viewing) → an endless in-app-browser loop. The custom
//     scheme is not an http navigation, so it never reloads the page.
//   - The scheme is registered by the app's Info.plist (`CFBundleURLSchemes`),
//     so iOS routes it to the installed app regardless of AASA / Universal Link
//     association state — which, for this app, is exactly what's failing (links
//     don't reliably open the app even from iMessage).
//
// A custom scheme has no graceful no-app fallback of its own: tapped without the
// app installed it pops iOS's "Cannot Open Page" alert (or nothing). So we add a
// **timed fallback** — after the tap, if the page is still foregrounded a beat
// later (the app didn't take over), we continue on the web automatically instead
// of stranding the user on a dead button. If the app DID open, iOS backgrounds
// this WebView and *pauses* JS timers, so the callback only runs after a long
// wall-clock gap, which we detect and ignore. (`Continue here instead` is still
// there for anyone who'd rather not wait.)
//
// The `<a>` also needs an explicit `fontFamily`: a raw DOM element doesn't
// inherit RN-Web's injected text font, so without this it renders in the UA
// serif (Times). The value mirrors RN-Web's default `Text` stack exactly.

import { type CSSProperties, useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Button, Card, Text, tokens } from "../../../theme";
import type { OpenInAppCardProps } from "./impl";

export type { OpenInAppCardProps } from "./impl";

// How long to wait after the tap before assuming the app didn't open and
// continuing on the web. Long enough that a real app-open backgrounds us first
// (iOS scheme opens are sub-second); short enough to not feel stuck.
const FALLBACK_MS = 2000;

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
};

export function OpenInAppCard({ appName, url, onContinue }: OpenInAppCardProps) {
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear a pending fallback if we unmount first (e.g. onContinue already fired).
  useEffect(
    () => () => {
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    },
    [],
  );

  // NOTE: no preventDefault — the anchor's own navigation is the real user
  // gesture that opens the app (a scripted `window.location` wouldn't). We only
  // arm the web fallback alongside it.
  const onOpenTap = () => {
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    const tappedAt = Date.now();
    fallbackTimer.current = setTimeout(() => {
      fallbackTimer.current = null;
      // Fired roughly on schedule ⇒ still foregrounded ⇒ the app didn't open, so
      // fall back to the web. A much larger gap ⇒ we were backgrounded while the
      // app was open ⇒ leave the user where they are.
      if (Date.now() - tappedAt < FALLBACK_MS + 750) onContinue();
    }, FALLBACK_MS);
  };

  return (
    <Card style={styles.card} elevated>
      <View style={styles.header}>
        <Text style={styles.glyph}>🎮</Text>
        <Text variant="title" style={styles.title}>
          Open in {appName}
        </Text>
        <Text tone="secondary" style={styles.body}>
          Tap below to jump to the app — or keep going here in your browser.
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
