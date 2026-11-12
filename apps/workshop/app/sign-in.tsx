import { useAppleSignIn } from "@workshop/api-client/oauth/apple";
import {
  Button,
  EmojiBadge,
  GoogleSignInButton,
  type ListColorKey,
  layout,
  Screen,
  screenColumnStyle,
  Text,
  tokens,
} from "@workshop/ui";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { AppleSignInButton } from "../src/components/AppleSignInButton";
import { useAuth } from "../src/hooks/useAuth";
import { type SignInContext, useSignInContext } from "../src/hooks/useSignInContext";
import { takeDeletionNotice } from "../src/lib/accountDeletion";
import { type SignInProvider, signInErrorMessage } from "../src/lib/errorCopy";
import { GOOGLE_SIGN_IN_CONFIGURED } from "../src/lib/googleSignIn";
import { shareCaption } from "../src/lib/sharePayload";

const DEV_AUTH_ENABLED = process.env.EXPO_PUBLIC_DEV_AUTH === "1";

/** What Workshop is, in the product's voice (4.1). */
const SIGN_IN_TAGLINE = "Lists you keep together, for later.";

/**
 * Sign-in (UX pass 4.1, 4.5). Says what Workshop is under the wordmark, or,
 * when the visitor came from a share link, shows that list instead ("Sign in
 * to join Date ideas"). Errors are plain sentences. Terms and Privacy sit
 * under the buttons; on iOS the Apple button is the system one.
 */
export default function SignIn() {
  const { signInWithApple, signInWithGoogle, signInDev } = useAuth();
  const apple = useAppleSignIn();
  const router = useRouter();
  const context = useSignInContext();
  // A delete that just finished leaves its outcome for this screen (4.5).
  const [deletion] = useState(() => takeDeletionNotice());
  const [busy, setBusy] = useState<SignInProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(provider: SignInProvider, task: () => Promise<void>) {
    try {
      setBusy(provider);
      setError(null);
      await task();
    } catch (e) {
      setError(signInErrorMessage(provider, e));
    } finally {
      setBusy(null);
    }
  }

  const handleApple = () =>
    run("apple", async () => {
      const result = await apple.signIn();
      if (result) await signInWithApple(result);
    });

  return (
    <Screen style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.scroll, screenColumnStyle]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topSpacer} />
        <View style={styles.column}>
          <View style={styles.wordmarkRow} accessibilityRole="header" accessibilityLabel="Workshop">
            <Text style={styles.wordmark}>workshop</Text>
            <View style={styles.dot} />
            <Text style={styles.wordmarkAccent}>dev</Text>
          </View>
          <Intro context={context} />
          {deletion ? (
            <View style={styles.notice} testID="sign-in-deleted-notice">
              <Text variant="label">Your account is deleted.</Text>
              {deletion.lines.map((line) => (
                <Text key={line} variant="caption" tone="secondary">
                  {line}
                </Text>
              ))}
            </View>
          ) : null}
        </View>

        <View style={[styles.column, styles.actions]}>
          {apple.available ? (
            <AppleSignInButton
              testID="sign-in-apple"
              loading={busy === "apple"}
              disabled={busy !== null}
              onPress={() => void handleApple()}
            />
          ) : null}
          {GOOGLE_SIGN_IN_CONFIGURED ? (
            <GoogleSignInButton
              onCredential={(result) => void run("google", () => signInWithGoogle(result))}
              onError={(e) => setError(signInErrorMessage("google", e))}
              loading={busy === "google"}
              disabled={busy !== null && busy !== "google"}
              controlBorder
            />
          ) : null}
          {DEV_AUTH_ENABLED ? (
            <>
              {apple.available || GOOGLE_SIGN_IN_CONFIGURED ? (
                <View style={styles.divider} accessibilityElementsHidden>
                  <View style={styles.dividerLine} />
                  <Text variant="eyebrow">or</Text>
                  <View style={styles.dividerLine} />
                </View>
              ) : null}
              <Button
                testID="sign-in-dev"
                label="Dev sign-in"
                variant="ghost"
                size="md"
                loading={busy === "dev"}
                disabled={busy !== null}
                onPress={() =>
                  void run("dev", () =>
                    signInDev({ email: "joshlebed@gmail.com", displayName: "Josh" }),
                  )
                }
              />
            </>
          ) : null}
          {!apple.available && !GOOGLE_SIGN_IN_CONFIGURED && !DEV_AUTH_ENABLED ? (
            <Text tone="muted" style={styles.center} testID="sign-in-providers-unconfigured">
              Sign-in isn't available in this version of the app.
            </Text>
          ) : null}
          {error ? (
            <Text
              tone="danger"
              style={styles.center}
              testID="sign-in-error"
              accessibilityRole="alert"
            >
              {error}
            </Text>
          ) : null}
        </View>

        <View style={styles.bottomSpacer} />
        <View style={[styles.column, styles.legal]}>
          <Text variant="caption" tone="muted" style={styles.center}>
            By continuing, you agree to the terms.
          </Text>
          <View style={styles.legalLinks}>
            <Button
              label="Terms"
              variant="ghost"
              size="md"
              onPress={() => router.push("/terms")}
              testID="sign-in-terms"
            />
            <Button
              label="Privacy"
              variant="ghost"
              size="md"
              onPress={() => router.push("/privacy")}
              testID="sign-in-privacy"
            />
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

function Intro({ context }: { context: SignInContext }) {
  if (context?.kind === "list") {
    const { preview, action } = context;
    const accent = tokens.list[preview.color as ListColorKey] ?? tokens.accent.default;
    return (
      <View style={styles.listIntro} testID="sign-in-list-context">
        <EmojiBadge emoji={preview.emoji} color={accent} size={44} shape="rounded" />
        <View style={styles.listIntroText}>
          <Text variant="heading" numberOfLines={2}>
            {action === "join"
              ? `Sign in to join ${preview.name}`
              : `Sign in to see ${preview.name}`}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {preview.ownerName
              ? `${preview.ownerName} shared it with you`
              : "Someone shared it with you"}
          </Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.taglineBlock}>
      <Text tone="secondary" style={styles.tagline} testID="sign-in-tagline">
        {SIGN_IN_TAGLINE}
      </Text>
      {context?.kind === "share" ? (
        <Text variant="caption" tone="muted" testID="sign-in-share-context">
          {`${shareCaption(context.payload)}. Sign in and pick a list for it.`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: layout.gutter,
    paddingVertical: tokens.space.xl,
    gap: tokens.space.xl,
  },
  // The brand block sits about 38% down: centred vertically left a void
  // above it on desktop, and on a phone the buttons stay in thumb reach.
  topSpacer: { flex: 0.7, minHeight: tokens.space.lg },
  bottomSpacer: { flex: 1, minHeight: tokens.space.lg },
  column: {
    gap: tokens.space.md,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  actions: { gap: tokens.space.sm },
  wordmarkRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: tokens.space.xsm,
  },
  // lineHeight must be set explicitly: the shared <Text> defaults to the
  // `body` variant (lineHeight 22), and overriding only fontSize would leave a
  // 34px glyph in a 22px line box, which iOS clips. The -1 tracking is the
  // logotype's own, tighter than the `display` text step.
  wordmark: {
    color: tokens.text.primary,
    fontSize: tokens.font.size.xxxl,
    lineHeight: tokens.font.lineHeight.xxxl,
    fontWeight: tokens.font.weight.semibold,
    letterSpacing: -1.0,
  },
  wordmarkAccent: {
    color: tokens.text.muted,
    fontSize: tokens.font.size.xxxl,
    lineHeight: tokens.font.lineHeight.xxxl,
    fontWeight: tokens.font.weight.regular,
    letterSpacing: -1.0,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.accent.default,
    transform: [{ translateY: -3 }],
  },
  taglineBlock: { gap: tokens.space.xs },
  tagline: { fontSize: tokens.font.size.lg, lineHeight: tokens.font.lineHeight.lg },
  listIntro: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.xs,
  },
  listIntroText: { flex: 1, minWidth: 0, gap: tokens.space.xxs },
  notice: {
    gap: tokens.space.xs,
    padding: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.surface,
  },
  center: { textAlign: "center" },
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
  legal: { gap: tokens.space.xxs, alignItems: "center" },
  legalLinks: { flexDirection: "row", justifyContent: "center", gap: tokens.space.xs },
});
