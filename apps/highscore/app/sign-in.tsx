import { useAppleSignIn } from "@workshop/api-client/oauth/apple";
import { GoogleSignInButton } from "@workshop/ui";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Wordmark } from "../src/components/Wordmark";
import { useAuth } from "../src/hooks/useAuth";
import { HsButton, HsText, hs } from "../src/theme";

const DEV_AUTH_ENABLED = process.env.EXPO_PUBLIC_DEV_AUTH === "1";
const GOOGLE_CONFIGURED = Boolean(
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
);

export default function SignIn() {
  const { signInWithApple, signInWithGoogle, signInDev } = useAuth();
  const apple = useAppleSignIn();
  const [busy, setBusy] = useState<"apple" | "google" | "dev" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleApple() {
    try {
      setBusy("apple");
      setError(null);
      const result = await apple.signIn();
      if (!result) return;
      await signInWithApple(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Apple sign-in failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleGoogleCredential(result: { idToken: string }) {
    try {
      setBusy("google");
      setError(null);
      await signInWithGoogle(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google sign-in failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleDev() {
    try {
      setBusy("dev");
      setError(null);
      await signInDev({ email: "joshlebed@gmail.com", displayName: "Josh" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.topSpacer} />
      <View style={styles.brandBlock}>
        <Wordmark size="lg" />
        <HsText tone="secondary">Compete in daily games</HsText>
      </View>

      <View style={styles.actions}>
        <HsButton
          testID="sign-in-apple"
          label="Continue with Apple"
          variant="primary"
          size="lg"
          loading={busy === "apple"}
          disabled={busy !== null || !apple.available}
          onPress={handleApple}
        />
        <GoogleSignInButton
          onCredential={handleGoogleCredential}
          onError={(e) => setError(e.message)}
          loading={busy === "google"}
          disabled={busy !== null && busy !== "google"}
        />
        {DEV_AUTH_ENABLED ? (
          <>
            <View style={styles.divider} accessibilityElementsHidden>
              <View style={styles.dividerLine} />
              <HsText tone="muted" style={styles.dividerText}>
                or
              </HsText>
              <View style={styles.dividerLine} />
            </View>
            <HsButton
              testID="sign-in-dev"
              label="Dev sign-in"
              variant="ghost"
              size="md"
              loading={busy === "dev"}
              disabled={busy !== null}
              onPress={handleDev}
            />
          </>
        ) : null}
        {!apple.available && !GOOGLE_CONFIGURED && !DEV_AUTH_ENABLED ? (
          <HsText tone="muted" style={styles.help} testID="sign-in-providers-unconfigured">
            Sign-in providers are still being configured.
          </HsText>
        ) : null}
        {error ? (
          <HsText tone="danger" style={styles.error}>
            {error}
          </HsText>
        ) : null}
      </View>

      <View style={styles.bottomSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: hs.color.bg,
    paddingHorizontal: hs.space.xl,
    paddingVertical: hs.space.xxl,
    gap: hs.space.xxl,
  },
  // Push the brand block to ~38% from the top — purely-vertical centering on
  // desktop leaves a void above the wordmark; this brings it closer to where
  // the eye naturally lands without crowding the top.
  topSpacer: { flex: 0.7 },
  bottomSpacer: { flex: 1 },
  brandBlock: {
    gap: hs.space.md,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  actions: {
    gap: hs.space.sm,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  error: { textAlign: "center", marginTop: hs.space.xs },
  help: { textAlign: "center", marginTop: hs.space.xs },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: hs.space.sm,
    paddingVertical: hs.space.xs,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: hs.color.border,
  },
  dividerText: {
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
});
