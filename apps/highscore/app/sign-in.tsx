import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { useAppleSignIn } from "@workshop/api-client/oauth/apple";
import { GoogleSignInButton } from "@workshop/ui";
import { type Href, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { AppleSignInButton } from "../src/components/AppleSignInButton";
import { AppStoreBadge } from "../src/components/AppStoreBadge";
import { Wordmark } from "../src/components/Wordmark";
import {
  invitePath,
  type PreloginInviteContext,
  type PreloginScoreDraft,
  signInContextCopy,
} from "../src/games/lib/preloginDraft";
import { loadLiveInviteContext, loadPreloginDraft } from "../src/games/lib/preloginDraftStore";
import { useAuth } from "../src/hooks/useAuth";
import { PRIVACY_ROUTE, TERMS_ROUTE } from "../src/lib/publicRoutes";
import { Avatar, Button, Text, tokens, uiType } from "../src/theme";

const DEV_AUTH_ENABLED = process.env.EXPO_PUBLIC_DEV_AUTH === "1";
// The "get the app" card only makes sense from the web app; inside the iOS
// app the visitor is already where it points. (iOS Safari additionally shows
// the native Smart App Banner via the apple-itunes-app meta in index.html.)
const SHOW_APP_STORE_CARD = Platform.OS === "web";
const GOOGLE_CONFIGURED = Boolean(
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
);

export default function SignIn() {
  const { signInWithApple, signInWithGoogle, signInDev } = useAuth();
  const apple = useAppleSignIn();
  const router = useRouter();
  const [busy, setBusy] = useState<"apple" | "google" | "dev" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invite = useInviteContext();

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
        <Text tone="secondary">Compete in daily games</Text>
      </View>

      {invite ? (
        <InviteContextHeader
          context={invite.context}
          draft={invite.draft}
          onBack={() =>
            router.replace(invitePath(invite.context.linkKind, invite.context.linkToken) as Href)
          }
        />
      ) : null}

      <View style={styles.actions}>
        {/* Apple's own button artwork (Guideline 4) — see AppleSignInButton. */}
        {apple.available ? (
          <AppleSignInButton
            testID="sign-in-apple"
            loading={busy === "apple"}
            disabled={busy !== null}
            onPress={handleApple}
          />
        ) : null}
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
        {/* Guidelines 1.2 + 5.1.2: the terms (no tolerance for abuse) and the
            privacy policy (scores are uploaded and shown to friends) are
            presented before sign-in, and both open without a session. */}
        <Text variant="caption" tone="muted" style={styles.legal} testID="sign-in-legal">
          By continuing you agree to HighScore's{" "}
          <Text
            variant="caption"
            tone="link"
            style={styles.legalLink}
            onPress={() => router.push(TERMS_ROUTE)}
            accessibilityRole="link"
            testID="sign-in-terms-link"
          >
            Terms of Use
          </Text>{" "}
          and{" "}
          <Text
            variant="caption"
            tone="link"
            style={styles.legalLink}
            onPress={() => router.push(PRIVACY_ROUTE)}
            accessibilityRole="link"
            testID="sign-in-privacy-link"
          >
            Privacy Policy
          </Text>
          . Scores you post are shared with your friends on HighScore.
        </Text>
      </View>

      {SHOW_APP_STORE_CARD ? (
        <View style={styles.appCard} testID="sign-in-app-store">
          <View style={styles.appCardCopy}>
            <Text variant="heading" style={styles.appCardText}>
              Get HighScore for iPhone
            </Text>
            <Text variant="label" tone="secondary" style={styles.appCardText}>
              Share your scores straight from any game
            </Text>
          </View>
          <AppStoreBadge />
          <Text
            variant="caption"
            tone="muted"
            style={styles.appCardText}
            testID="sign-in-app-store-relink"
          >
            After installing, tap your friend's link again to pick up where you left off.
          </Text>
        </View>
      ) : null}

      <View style={styles.bottomSpacer} />
    </View>
  );
}

/**
 * Score before sign-in: who invited this visitor (and the score they pasted),
 * read from the stash the invite landing wrote. Null when they came any other
 * way, or the stash is stale (its pending link is gone or a day old).
 */
function useInviteContext(): {
  context: PreloginInviteContext;
  draft: PreloginScoreDraft | null;
} | null {
  const [state, setState] = useState<{
    context: PreloginInviteContext;
    draft: PreloginScoreDraft | null;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const context = await loadLiveInviteContext(Date.now());
      if (!context) return;
      const draft = await loadPreloginDraft();
      if (!cancelled) setState({ context, draft });
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

function InviteContextHeader({
  context,
  draft,
  onBack,
}: {
  context: PreloginInviteContext;
  draft: PreloginScoreDraft | null;
  onBack: () => void;
}) {
  const copy = signInContextCopy(context, draft);
  return (
    <View style={styles.invite} testID="sign-in-invite-context">
      <Avatar
        name={context.inviterName}
        imageUrl={userAvatarImageUrl(context.inviterId)}
        size="md"
      />
      <View style={styles.inviteCopy}>
        <Text variant="heading" testID="sign-in-invite-title">
          {copy.title}
        </Text>
        <Text tone="secondary" testID="sign-in-invite-caption">
          {copy.caption}
        </Text>
        <Text
          variant="caption"
          tone="link"
          style={styles.legalLink}
          onPress={onBack}
          accessibilityRole="link"
          testID="sign-in-invite-back"
        >
          Back to the invite
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  invite: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
    padding: tokens.space.md,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.bg.surface,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  inviteCopy: { flex: 1, gap: tokens.space.xs },
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
  legal: { textAlign: "center", marginTop: tokens.space.md, lineHeight: 18 },
  // Small pink text: the tint keeps it legible at caption size (DESIGN.md).
  legalLink: { textDecorationLine: "underline", color: tokens.neon.pinkTint },
  appCard: {
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
    alignItems: "center",
    gap: tokens.space.lg,
    padding: tokens.space.lg,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.bg.surface,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  appCardCopy: { gap: tokens.space.xs },
  appCardText: { textAlign: "center" },
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
    backgroundColor: tokens.border.default,
  },
  dividerText: uiType(8),
});
