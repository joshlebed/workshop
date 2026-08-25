// Native Apple Sign In via expo-apple-authentication. iOS-only — Android falls
// back to the unavailable case (returns null from signIn). Web uses the
// `.web.ts` variant.

import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useState } from "react";

export interface AppleSignInResult {
  identityToken: string;
  nonce?: string;
  email?: string;
  fullName?: string;
}

export interface AppleSignInState {
  available: boolean;
  signIn: () => Promise<AppleSignInResult | null>;
}

async function makeNonce(): Promise<string> {
  return Crypto.randomUUID();
}

export function useAppleSignIn(): AppleSignInState {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    AppleAuthentication.isAvailableAsync()
      .then(setAvailable)
      .catch(() => setAvailable(false));
  }, []);

  const signIn = useCallback(async (): Promise<AppleSignInResult | null> => {
    const rawNonce = await makeNonce();
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce,
    );
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });
      if (!credential.identityToken) return null;
      // Apple hashes the nonce we send and echoes the hash back in the JWT's
      // `nonce` claim. The backend compares the value we forward against
      // `claims.nonce`, so we must forward the hashed value (not the raw).
      const result: AppleSignInResult = {
        identityToken: credential.identityToken,
        nonce: hashedNonce,
      };
      if (credential.email) result.email = credential.email;
      const given = credential.fullName?.givenName ?? "";
      const family = credential.fullName?.familyName ?? "";
      const fullName = [given, family].filter(Boolean).join(" ").trim();
      if (fullName) result.fullName = fullName;
      return result;
    } catch (e) {
      // ERR_REQUEST_CANCELED → user dismissed the sheet; surface as null.
      const code = (e as { code?: string } | null)?.code;
      if (code === "ERR_REQUEST_CANCELED") return null;
      throw e;
    }
  }, []);

  return { available, signIn };
}
