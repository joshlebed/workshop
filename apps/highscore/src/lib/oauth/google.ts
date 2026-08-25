// Copied verbatim from apps/workshop/src/lib/oauth/google.ts. Brand-neutral provider
// glue that both apps need; PR-1 extracted the API client but not this layer
// (the .web variants need the packages/*/src/x/index.ts platform-shim shape —
// see CLAUDE.md "Metro does NOT apply .web.ts resolution to a package exports
// target"). Tracked in AGENT-REFLECTIONS.md; keep the two copies in sync until
// then.
// Native Google Sign In via expo-auth-session/providers/google.
// Returns the id_token for the iOS audience configured in
// EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID. Web uses the `.web.ts` variant.

import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useRef } from "react";

WebBrowser.maybeCompleteAuthSession();

export interface GoogleSignInResult {
  idToken: string;
}

export interface GoogleSignInState {
  available: boolean;
  signIn: () => Promise<GoogleSignInResult | null>;
}

type PendingResolver = (result: GoogleSignInResult | null) => void;

// Google's iOS OAuth client type only supports the authorization-code flow,
// not the id_token implicit flow. expo-auth-session's Google provider handles
// that by auto-exchanging the code for tokens inside a useEffect after
// promptAsync() resolves — so the promise from promptAsync() returns a result
// whose params contain `code` but no `id_token`, and `authentication` is
// undefined. Reading the idToken straight off that result silently returns
// null and the caller bounces back to the sign-in screen.
//
// We bridge by holding a pending resolver and completing it once the hook's
// `response` state catches up with the exchanged idToken.
const AUTH_TIMEOUT_MS = 30_000;

export function useGoogleSignIn(): GoogleSignInState {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "";
  // useAuthRequest accepts an empty config for unconfigured clients but the
  // promptAsync() call will throw — guard with `available`.
  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: iosClientId || undefined,
  });

  const pendingResolverRef = useRef<PendingResolver | null>(null);
  const lastConsumedResponseRef = useRef<typeof response | null>(null);

  useEffect(() => {
    const resolver = pendingResolverRef.current;
    if (!resolver) return;
    if (!response) return;
    // Skip the response we already handled (avoids re-resolving on re-render).
    if (response === lastConsumedResponseRef.current) return;

    if (response.type !== "success") {
      lastConsumedResponseRef.current = response;
      pendingResolverRef.current = null;
      resolver(null);
      return;
    }
    const idToken =
      (typeof response.params?.id_token === "string" ? response.params.id_token : null) ??
      response.authentication?.idToken ??
      null;
    if (!idToken) {
      // Code is in, exchange hasn't completed yet — wait for the next update.
      return;
    }
    lastConsumedResponseRef.current = response;
    pendingResolverRef.current = null;
    resolver({ idToken });
  }, [response]);

  const available = Boolean(iosClientId) && Boolean(request);

  const signIn = useCallback(async (): Promise<GoogleSignInResult | null> => {
    if (!available) return null;

    // Mark the existing response as already-consumed so a stale value from a
    // previous sign-in doesn't immediately resolve this attempt.
    lastConsumedResponseRef.current = response ?? null;

    const exchanged = new Promise<GoogleSignInResult | null>((resolve) => {
      pendingResolverRef.current = resolve;
    });

    const result = await promptAsync();
    if (result.type !== "success") {
      pendingResolverRef.current = null;
      return null;
    }
    // Fast path for implicit flows that already have the id_token.
    const directIdToken =
      (typeof result.params?.id_token === "string" ? result.params.id_token : null) ??
      result.authentication?.idToken ??
      null;
    if (directIdToken) {
      pendingResolverRef.current = null;
      return { idToken: directIdToken };
    }

    // Code flow: wait for the hook's response-state effect to finish the
    // code↔token exchange. Time-bounded so a stuck exchange doesn't hang the UI.
    return await Promise.race<GoogleSignInResult | null>([
      exchanged,
      new Promise<null>((resolve) => {
        setTimeout(() => {
          if (pendingResolverRef.current) {
            pendingResolverRef.current = null;
            resolve(null);
          }
        }, AUTH_TIMEOUT_MS);
      }),
    ]);
  }, [available, promptAsync, response]);

  return { available, signIn };
}
