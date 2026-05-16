import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useAuth } from "../src/hooks/useAuth";
import { useAppleSignIn } from "../src/lib/oauth/apple";
import { useGoogleSignIn } from "../src/lib/oauth/google";
import { Button, Text, tokens } from "../src/ui/index";

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
      setError(e instanceof Error ? e.message : "Apple sign-in failed");
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
      setError(e instanceof Error ? e.message : "Google sign-in failed");
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
      setError(e instanceof Error ? e.message : "Sign in failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.topSpacer} />
      <View style={styles.brandBlock}>
        <View style={styles.wordmarkRow}>
          <Text style={styles.wordmark}>workshop</Text>
          <View style={styles.dot} />
          <Text style={styles.wordmarkAccent}>dev</Text>
        </View>
        <Text tone="secondary" style={styles.tagline}>
          A quiet place for the lists you keep together.
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
      </View>

      <View style={styles.bottomSpacer} />
      <Text tone="muted" style={styles.footer}>
        A personal, experimental app. Use it gently.
      </Text>
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
  // the eye naturally lands without crowding the top. On mobile the safe-area
  // padding plus this ratio still leaves the buttons in thumb reach.
  topSpacer: { flex: 0.7 },
  bottomSpacer: { flex: 1 },
  brandBlock: {
    gap: tokens.space.md,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  wordmarkRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  wordmark: {
    color: tokens.text.primary,
    fontSize: 34,
    fontWeight: tokens.font.weight.semibold,
    letterSpacing: -1.0,
  },
  wordmarkAccent: {
    color: tokens.text.muted,
    fontSize: 34,
    fontWeight: tokens.font.weight.regular,
    letterSpacing: -1.0,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: tokens.accent.default,
    transform: [{ translateY: -3 }],
  },
  tagline: {
    fontSize: tokens.font.size.md,
    lineHeight: 22,
    maxWidth: 320,
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
  footer: {
    fontSize: tokens.font.size.xs,
    maxWidth: 320,
    alignSelf: "center",
    textAlign: "center",
  },
});
