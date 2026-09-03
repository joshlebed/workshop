import { useAppleSignIn } from "@workshop/api-client/oauth/apple";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { BrandIcon } from "../src/components/BrandIcon";
import { GoogleSignInButton } from "../src/components/GoogleSignInButton";
import { useAuth } from "../src/hooks/useAuth";
import { Button, Screen, Text, textGlow, tokens } from "../src/theme";

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
    <Screen testID="sign-in">
      <View style={styles.root}>
        <View style={styles.cabinet}>
          <BrandIcon size={112} />
          <Text variant="display" style={styles.wordmark}>
            HighScore
          </Text>
          <Text tone="secondary" style={styles.tagline}>
            One deck of daily games. You and your friends, same puzzles, same day.
          </Text>
        </View>

        <View style={styles.actions}>
          <Button
            testID="sign-in-apple"
            label="Continue with Apple"
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
            <Button
              testID="sign-in-dev"
              label="Dev sign-in"
              variant="ghost"
              loading={busy === "dev"}
              disabled={busy !== null}
              onPress={handleDev}
            />
          ) : null}
          {!apple.available && !GOOGLE_CONFIGURED && !DEV_AUTH_ENABLED ? (
            <Text tone="secondary" style={styles.help} testID="sign-in-providers-unconfigured">
              Sign-in providers are still being configured.
            </Text>
          ) : null}
          {error ? (
            <Text tone="danger" style={styles.help}>
              {error}
            </Text>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: tokens.space.xl,
    gap: tokens.space.xxl,
  },
  cabinet: { alignItems: "center", gap: tokens.space.lg },
  // The wordmark is one of the few elements allowed to glow.
  wordmark: { fontSize: 22, lineHeight: 34, ...textGlow(tokens.neon.pinkGlow, 12) },
  tagline: { textAlign: "center", maxWidth: 300, lineHeight: 22 },
  actions: { gap: tokens.space.sm },
  help: { textAlign: "center" },
});
