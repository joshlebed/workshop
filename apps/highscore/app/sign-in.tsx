import { useAppleSignIn } from "@workshop/api-client/oauth/apple";
import { GoogleSignInButton } from "@workshop/ui";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Wordmark } from "../src/components/Wordmark";
import { useAuth } from "../src/hooks/useAuth";
import { Button, Text, tokens } from "../src/theme";

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
      {/* Same shape as the feed it opens onto: the mark at the top, a rule
          under it, and the one thing to do pinned to the bottom. */}
      <View style={styles.brandBlock}>
        <Wordmark size="lg" />
        <View style={styles.rule} />
        <Text tone="secondary" style={styles.pitch}>
          Your daily games, your friends, one scoreboard. Paste a result and it lands on everyone's
          board.
        </Text>
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
          <Button
            testID="sign-in-dev"
            label="Dev sign-in"
            variant="ghost"
            size="md"
            loading={busy === "dev"}
            disabled={busy !== null}
            onPress={handleDev}
          />
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    paddingHorizontal: tokens.space.xl,
    paddingVertical: tokens.space.xxl,
    // One centred lockup rather than a mark at the top and buttons at the
    // bottom with 400px of nothing between them.
    justifyContent: "center",
    gap: tokens.space.xl,
  },
  brandBlock: {
    gap: tokens.space.md,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  rule: { height: tokens.bezel, backgroundColor: tokens.border.default },
  pitch: { maxWidth: 340 },
  actions: {
    gap: tokens.space.sm,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  error: { textAlign: "center", marginTop: tokens.space.xs },
  help: { textAlign: "center", marginTop: tokens.space.xs },
});
