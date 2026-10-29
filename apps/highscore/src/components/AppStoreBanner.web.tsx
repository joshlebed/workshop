import { HIGHSCORE_APP_STORE_URL } from "@workshop/shared/constants";
import { CloseIcon, IconButton, Text, tokens } from "@workshop/ui";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { appStoreBannerDismissCookie, shouldShowAppStoreBanner } from "../lib/appStoreBanner";
import { BrandIcon } from "./BrandIcon";

interface AppStoreBannerProps {
  /** Suppress on surfaces that already carry an App Store call-to-action. */
  hidden?: boolean;
}

function readInitialVisibility(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  // `navigator.standalone` is iOS Safari's home-screen-app flag (non-standard).
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return shouldShowAppStoreBanner({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    cookie: document.cookie,
    standalone,
  });
}

/**
 * Slim "Get the HighScore app" strip pinned above the router on iPhone / iPad
 * browsers. Complements the Safari-only Smart App Banner (`apple-itunes-app`
 * meta in public/index.html), which Chrome, Firefox and in-app browsers never
 * render. The X writes a long-lived cookie, so the dismissal sticks for this
 * device and a new device sees the banner again (see `lib/appStoreBanner.ts`).
 */
export function AppStoreBanner({ hidden = false }: AppStoreBannerProps) {
  const [visible, setVisible] = useState(readInitialVisibility);
  if (!visible || hidden) return null;

  const dismiss = () => {
    // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is unsupported in Safari, the browser this banner targets.
    document.cookie = appStoreBannerDismissCookie(window.location.protocol === "https:");
    setVisible(false);
  };

  return (
    <View style={styles.root} testID="app-store-banner" accessibilityRole="none">
      <BrandIcon size={36} />
      <View style={styles.copy}>
        <Text variant="label" numberOfLines={1}>
          HighScore for iPhone
        </Text>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          Share scores straight from any game
        </Text>
      </View>
      <a
        href={HIGHSCORE_APP_STORE_URL}
        aria-label="Get HighScore on the App Store"
        data-testid="app-store-banner-link"
        style={linkStyle}
      >
        Get
      </a>
      <IconButton
        accessibilityLabel="Dismiss"
        onPress={dismiss}
        style={styles.close}
        testID="app-store-banner-dismiss"
      >
        <CloseIcon size={14} color={tokens.text.secondary} />
      </IconButton>
    </View>
  );
}

const linkStyle: React.CSSProperties = {
  display: "inline-block",
  paddingTop: 6,
  paddingBottom: 6,
  paddingLeft: tokens.space.md,
  paddingRight: tokens.space.md,
  borderRadius: 999,
  backgroundColor: tokens.accent.default,
  color: tokens.text.onAccent,
  fontSize: tokens.font.size.sm,
  fontWeight: tokens.font.weight.semibold,
  lineHeight: "18px",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingLeft: tokens.space.md,
    paddingRight: tokens.space.xs,
    paddingVertical: tokens.space.xs,
    backgroundColor: tokens.bg.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.border.subtle,
  },
  copy: { flex: 1, minWidth: 0 },
  close: { width: 36, height: 36 },
});
