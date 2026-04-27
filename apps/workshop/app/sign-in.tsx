import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useAuth } from "../src/hooks/useAuth";
import { useAppleSignIn } from "../src/lib/oauth/apple";
import { useGoogleSignIn } from "../src/lib/oauth/google";
import { Button, Card, Text, tokens } from "../src/ui/index";

const DEV_AUTH_ENABLED = process.env.EXPO_PUBLIC_DEV_AUTH === "1";

export default function SignIn() {
  const { signInWithApple, signInWithGoogle, signInDev } = useAuth();
  const apple = useAppleSignIn();
  const google = useGoogleSignIn();
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
      setError(e instanceof Error ? e.message : "apple sign-in failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleGoogle() {
    try {
      setBusy("google");
      setError(null);
      const result = await google.signIn();
      if (!result) return;
      await signInWithGoogle(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "google sign-in failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleDev() {
    try {
      setBusy("dev");
      setError(null);
      await signInDev({ email: "dev@workshop.local", displayName: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "sign in failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text variant="title">Workshop.dev</Text>
        <Text tone="secondary" style={styles.tagline}>
          Sign in to start building lists with people you share them with.
        </Text>
      </View>

      <Card style={styles.card} elevated>
        <Button
          testID="sign-in-apple"
          label="Continue with Apple"
          variant="secondary"
          size="lg"
          loading={busy === "apple"}
          disabled={busy !== null || !apple.available}
          onPress={handleApple}
        />
        <Button
          testID="sign-in-google"
          label="Continue with Google"
          variant="secondary"
          size="lg"
          loading={busy === "google"}
          disabled={busy !== null || !google.available}
          onPress={handleGoogle}
        />
        {DEV_AUTH_ENABLED ? (
          <Button
            testID="sign-in-dev"
            label="Dev sign-in (test only)"
            variant="primary"
            size="lg"
            loading={busy === "dev"}
            disabled={busy !== null}
            onPress={handleDev}
          />
        ) : null}
        {!apple.available && !google.available && !DEV_AUTH_ENABLED ? (
          <Text tone="muted" style={styles.help} testID="sign-in-providers-unconfigured">
            Sign-in providers are still being configured.
          </Text>
        ) : null}
        {error ? (
          <Text tone="danger" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </Card>

      <Text tone="muted" style={styles.footer}>
        By continuing you agree to use a personal, experimental app with no uptime guarantees.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    paddingHorizontal: tokens.space.xl,
    justifyContent: "center",
    gap: tokens.space.xxl,
  },
  header: { gap: tokens.space.md, alignItems: "center" },
  tagline: { textAlign: "center", maxWidth: 420 },
  card: { gap: tokens.space.md, maxWidth: 420, width: "100%", alignSelf: "center" },
  error: { textAlign: "center" },
  help: { textAlign: "center" },
  footer: { textAlign: "center", maxWidth: 420, alignSelf: "center" },
});
