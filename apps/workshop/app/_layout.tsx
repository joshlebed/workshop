import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { configureApiClient } from "@workshop/api-client/api";
import { stashSignupLanding } from "@workshop/api-client/signupAcquisition";
import { getItem, removeItem } from "@workshop/api-client/storage";
import {
  Button,
  ConfirmDialogHost,
  installWebFocusRing,
  Text,
  ThemeProvider,
  ToastProvider,
  tokens,
} from "@workshop/ui";
import {
  DarkTheme,
  type Href,
  ThemeProvider as NavigationThemeProvider,
  Stack,
  useNavigationContainerRef,
  useRouter,
  useSegments,
} from "expo-router";
import { useShareIntent } from "expo-share-intent";
import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { reportShareIntent, type ShareIntentTelemetry } from "../src/api/telemetry";
import { AuthProvider, type AuthStatus, useAuth } from "../src/hooks/useAuth";
import { type NavState, registerNavigationState } from "../src/lib/goBack";
import { PENDING_INVITE_TOKEN_KEY } from "../src/lib/inviteStash";
import { OfflineRetryWatcher } from "../src/lib/OfflineRetryWatcher";
import { createQueryClient, getPersistOptions } from "../src/lib/query";
import { safeReturnPath } from "../src/lib/returnPath";
import { PENDING_RETURN_PATH_KEY } from "../src/screens/ListPublicLanding";

// Web: remember the very first page load's referrer / landing path / utm_* for
// signup attribution, before any redirect rewrites the URL (no-op on native and
// after the first visit). Sent with the next Apple/Google sign-in.
void stashSignupLanding();

configureApiClient({ client: "workshop" });

function useApplyOtaUpdatesOnArrival() {
  const { isUpdatePending } = Updates.useUpdates();
  useEffect(() => {
    if (isUpdatePending) Updates.reloadAsync().catch(() => {});
  }, [isUpdatePending]);
}

// iOS Share Extension hand-off. When the user taps Share → "Workshop" in
// another app, expo-share-intent's native code stashes the payload in App
// Group UserDefaults and opens `workshop:///dataUrl=workshopShareKey`; the
// hook reads it back and surfaces a `shareIntent`. We forward to `/share`
// with `url` and/or `text`, which hands straight to the list-add flow. The sentinel URL is swallowed by
// `app/+native-intent.tsx`; without that, expo-router would render its
// "Unmatched Route" screen before this hook fires.
// Signed-out users currently lose the payload — AuthGate bounces them to
// `/sign-in` first; stashing through auth (cf. inviteStash) is a follow-up.
type ShareIntentPayload = ReturnType<typeof useShareIntent>["shareIntent"];

// Snapshot the shape of what the native share extension handed us. Reported to
// the server (`/v1/telemetry/share-intent`) and logged to the JS console so the
// extension's payload — does the result text survive the share sheet, or do we
// only get the game's referral URL? — is debuggable without a Mac/device
// debugger. Previews are capped; the share text is the user's own game result.
function buildShareIntentTelemetry(
  shareIntent: ShareIntentPayload,
  source: string,
): ShareIntentTelemetry {
  const text = shareIntent?.text ?? null;
  const webUrl = shareIntent?.webUrl ?? null;
  const meta: unknown = shareIntent?.meta;
  const files: unknown = shareIntent?.files;
  return {
    source,
    type: shareIntent?.type ?? null,
    hasWebUrl: !!webUrl,
    webUrlLen: webUrl?.length ?? 0,
    hasText: !!text,
    textLen: text?.length ?? 0,
    textPreview: text ? text.slice(0, 240) : undefined,
    webUrlPreview: webUrl ? webUrl.slice(0, 240) : undefined,
    fileCount: Array.isArray(files) ? files.length : 0,
    metaKeys:
      meta && typeof meta === "object" ? Object.keys(meta as object).slice(0, 40) : undefined,
    runtimeVersion: Updates.runtimeVersion ?? null,
    updateId: Updates.updateId ?? null,
  };
}

function useShareIntentRedirect(status: AuthStatus) {
  const router = useRouter();
  const { token } = useAuth();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  // Dedupe telemetry to one report per distinct payload (the effect re-runs on
  // unrelated renders while the intent is pending).
  const lastReportedRef = useRef<string | null>(null);
  useEffect(() => {
    if (status !== "signed-in" || !hasShareIntent) return;

    const signature = `${shareIntent?.type ?? ""}|${shareIntent?.webUrl ?? ""}|${shareIntent?.text ?? ""}`;
    if (lastReportedRef.current !== signature) {
      lastReportedRef.current = signature;
      const snapshot = buildShareIntentTelemetry(shareIntent, "layout-redirect");
      console.log("[share-intent]", JSON.stringify(snapshot));
      void reportShareIntent(snapshot, token);
    }

    const webUrl = shareIntent?.webUrl?.trim();
    const text = shareIntent?.text?.trim();
    const params = new URLSearchParams();
    if (webUrl) params.set("url", webUrl);
    if (text) params.set("text", text);
    const query = params.toString();
    if (!query) return;
    router.replace(`/share?${query}`);
    resetShareIntent();
  }, [status, hasShareIntent, shareIntent, router, resetShareIntent, token]);
}

function AuthGate() {
  const { status, refresh } = useAuth();
  useShareIntentRedirect(status);
  // Widen to `string[]` so segments[1] typechecks without the typed-routes
  // augmentation (`.expo/types/router.d.ts`), which is gitignored and not
  // generated in CI. Group segments (`(tabs)`, `(lists)`) are stripped so
  // the route checks below keep matching URL-shaped paths — the groups
  // never appear in URLs but DO appear in `useSegments()`.
  const rawSegments: string[] = useSegments();
  const segments = rawSegments.filter((segment) => !segment.startsWith("("));
  const router = useRouter();
  // Latched once we've resolved the post-sign-in destination (invite vs.
  // home). Prevents the async stash lookup from racing a synchronous
  // home-bounce: without this, two effects fire on the same status flip,
  // segments change before `await getItem(...)` resumes, the cleanup
  // `cancelled = true` fires, and the invite redirect is dropped — the
  // user lands on home with the token still sitting in localStorage.
  const postSignInResolvedRef = useRef(false);

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unavailable") return;
    const first = segments[0];
    const onSignIn = first === "sign-in";
    const onOnboarding = first === "onboarding";
    const onAcceptInvite = onOnboarding && segments[1] === "accept-invite";
    const onInvite = first === "invite";
    // Friend invite link (`/friends/accept/:token`). Friends live in HighScore
    // now; the route is a pure hand-off that needs no session.
    const onFriendAccept = first === "friends" && segments[1] === "accept";
    // Play link (`/g/:token`). Games live in HighScore now; the route is a
    // pure hand-off that needs no session, so it mounts signed-out.
    const onGameShare = first === "g";

    if (status !== "signed-in") {
      postSignInResolvedRef.current = false;
    }

    // `/list/:id` (no trailing subroute) is the public-landing entry point;
    // signed-out visitors should see the landing page itself, not get
    // bounced to /sign-in. Subroutes like `/list/:id/settings` remain
    // member-only and fall through to the normal gate.
    const onListLanding = first === "list" && segments.length === 2;
    // `/l/:slug` is the short share URL and the main way into a list. It must
    // mount signed-out too so the landing can stash its return path; without
    // this a new visitor was bounced to /sign-in before the landing rendered
    // and ended up on an empty home after sign-up (0.3).
    const onShareLanding = first === "l" && segments.length === 2;

    if (status === "signed-out") {
      // Let `/invite/:token`, `/onboarding/accept-invite`, and the public
      // list landing mount briefly so they can stash a return target
      // before AuthGate forwards to /sign-in.
      if (
        !onSignIn &&
        !onInvite &&
        !onAcceptInvite &&
        !onListLanding &&
        !onShareLanding &&
        !onFriendAccept &&
        !onGameShare
      ) {
        router.replace("/sign-in");
      }
      return;
    }
    if (status === "needs-display-name") {
      // Stay on onboarding until the name is saved. This used to fall through
      // to the signed-in bounce below while on `/onboarding/display-name`,
      // which consumed the return-path stash and sent a brand-new user home,
      // then back to onboarding, in a loop (0.3).
      if (!onOnboarding) router.replace("/onboarding/display-name");
      return;
    }
    // status === "signed-in". Signed-in users on `/list/...`,
    // `/create-list/...`, or `/onboarding/accept-invite` are left alone.
    const needsPostSignInBounce = onSignIn || (onOnboarding && !onAcceptInvite);
    if (!needsPostSignInBounce || postSignInResolvedRef.current) return;
    postSignInResolvedRef.current = true;

    // Consult the invite stash before bouncing to home so a user who arrived
    // via an invite link lands on the list they were invited to. The
    // accept-invite screen owns the eventual `removeItem` call. If no invite
    // stash, also check the return-path stash (set by `ListPublicLanding`
    // when an unauthed visitor signs in from the per-list landing page) so
    // they land back on `/list/:id` instead of home.
    (async () => {
      const stashed = await getItem(PENDING_INVITE_TOKEN_KEY).catch(() => null);
      if (stashed) {
        router.replace(`/onboarding/accept-invite?token=${encodeURIComponent(stashed)}`);
        return;
      }
      // The stash is single-use: clear it whatever it held, so a stale path
      // can't hijack a later sign-in.
      const rawReturnPath = await getItem(PENDING_RETURN_PATH_KEY).catch(() => null);
      if (rawReturnPath !== null) await removeItem(PENDING_RETURN_PATH_KEY).catch(() => {});
      const returnPath = safeReturnPath(rawReturnPath);
      if (returnPath) {
        // `safeReturnPath` only passes `/l/…` and `/list/…`. `withAnchor` keeps
        // home beneath a `/list/…` target so its back button pops instead of
        // replacing forward (see apps/workshop/CLAUDE.md).
        router.replace(returnPath as Href, { withAnchor: true });
        return;
      }
      router.replace("/");
    })();
  }, [status, segments, router]);

  if (status === "loading") {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: tokens.bg.canvas,
        }}
      >
        <ActivityIndicator color={tokens.accent.default} />
      </View>
    );
  }

  if (status === "unavailable") {
    return (
      <SafeAreaView
        edges={["top", "bottom"]}
        style={{ flex: 1, backgroundColor: tokens.bg.canvas }}
      >
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: tokens.space.xl,
          }}
        >
          <View style={{ width: "100%", maxWidth: 340, gap: tokens.space.md }}>
            <Text variant="heading" style={{ textAlign: "center" }}>
              Can’t connect
            </Text>
            <Text tone="secondary" style={{ textAlign: "center" }}>
              Your session is still saved. Check your connection and try again.
            </Text>
            <Button label="Try again" size="lg" onPress={() => void refresh()} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: tokens.bg.canvas }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: tokens.bg.canvas },
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
        }}
      >
        {/* The Lists surface (home, lists, create-list) lives in
            the (tabs)/(lists) group — see app/(tabs)/_layout.tsx. Routes
            below stay outside the tab shell: auth, onboarding, invites,
            activity, and the share-intent flow overlay whichever tab is active. */}
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="activity" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="admin/analytics" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="onboarding/display-name" />
        <Stack.Screen name="onboarding/accept-invite" />
        <Stack.Screen name="invite/[token]" />
        <Stack.Screen name="friends/accept/[token]" />
        <Stack.Screen name="g/[token]" />
        <Stack.Screen name="share/index" />
        <Stack.Screen name="share/pick-list" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="+not-found" />
      </Stack>
    </SafeAreaView>
  );
}

// Web: the app's one keyboard focus ring (`:focus-visible` only). No-op on native.
installWebFocusRing();

export default function RootLayout() {
  useApplyOtaUpdatesOnArrival();
  // `goBack` reads the focused stack to tell real history from the home
  // anchor a cold-opened route gets (3.8).
  const navigationRef = useNavigationContainerRef();
  useEffect(() => {
    registerNavigationState(() =>
      navigationRef.isReady() ? (navigationRef.getRootState() as NavState | undefined) : undefined,
    );
  }, [navigationRef]);
  const queryClient = useMemo(() => createQueryClient(), []);
  const persistOptions = useMemo(() => getPersistOptions(), []);
  // Light mode is off for now (UX pass decision, 2026-11-11): every screen
  // paints the dark tokens, so the navigation theme and the status bar are
  // pinned dark too. Following the system put dark glyphs over a dark app on
  // light-mode phones (0.15).
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <ThemeProvider forceScheme="dark">
            <NavigationThemeProvider value={DarkTheme}>
              <StatusBar style="light" />
              <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
                <ToastProvider>
                  <OfflineRetryWatcher />
                  <AuthProvider>
                    <AuthGate />
                  </AuthProvider>
                  {/* Backs `confirm()` on web with the in-app dialog. */}
                  <ConfirmDialogHost />
                </ToastProvider>
              </PersistQueryClientProvider>
            </NavigationThemeProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
