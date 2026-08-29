import { useAppleSignIn } from "@workshop/api-client/oauth/apple";
import { Button, GoogleSignInButton, Text, tokens } from "@workshop/ui";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Wordmark } from "../src/components/Wordmark";
import { useAuth } from "../src/hooks/useAuth";
import { DEV_AUTH_USER } from "../src/lib/devAuthUser";

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
      await signInDev(DEV_AUTH_USER);
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
        <Text tone="secondary">Compete in daily games</Text>
      </View>

      <View style={styles.actions}>
        <Button
          testID="sign-in-apple"
          label="Continue with Apple"
          variant="secondary"
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
              <Text tone="muted" style={styles.dividerText}>
                or
              </Text>
              <View style={styles.dividerLine} />
            </View>
            <Button
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
          <Text tone="muted" style={styles.help} testID="sign-in-providers-unconfigured">
            Sign-in providers are still being configured.
          </Text>
        ) : null}
        {error ? (
          <Text tone="danger" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </View>

      <View style={styles.bottomSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    paddingHorizontal: tokens.space.xl,
    paddingVertical: tokens.space.xxl,
    gap: tokens.space.xxl,
  },
  // Push the brand block to ~38% from the top — purely-vertical centering on
  // desktop leaves a void above the wordmark; this brings it closer to where
  // the eye naturally lands without crowding the top.
  topSpacer: { flex: 0.7 },
  bottomSpacer: { flex: 1 },
  brandBlock: {
    gap: tokens.space.md,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  actions: {
    gap: tokens.space.sm,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  error: { textAlign: "center", marginTop: tokens.space.xs },
  help: { textAlign: "center", marginTop: tokens.space.xs },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingVertical: tokens.space.xs,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: tokens.border.subtle,
  },
  dividerText: {
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
});
