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

export function useGoogleSignIn(): GoogleSignInState {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "";
  // useAuthRequest accepts an empty config for unconfigured clients but the
  // promptAsync() call will throw — guard with `available`.
  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: iosClientId || undefined,
  });

  // Cache the latest response so the promptAsync caller's promise can pick it
  // up. expo-auth-session resolves promptAsync's promise with the result, so
  // we don't actually need this — but we hold a ref in case future callers
  // want to subscribe.
  const lastResponse = useRef(response);
  useEffect(() => {
    lastResponse.current = response;
  }, [response]);

  const available = Boolean(iosClientId) && Boolean(request);

  const signIn = useCallback(async (): Promise<GoogleSignInResult | null> => {
    if (!available) return null;
    const result = await promptAsync();
    if (result.type !== "success") return null;
    const idToken = result.params?.id_token ?? result.authentication?.idToken ?? null;
    if (!idToken) return null;
    return { idToken };
  }, [available, promptAsync]);

  return { available, signIn };
}
