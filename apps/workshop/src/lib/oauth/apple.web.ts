// Web Apple Sign In via Apple's "Sign in with Apple JS" SDK. Loaded
// lazily on first use; subsequent calls reuse the same global.

import { useCallback, useEffect, useState } from "react";

const APPLE_JS_URL =
  "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";
const SCRIPT_ID = "appleid-auth-script";

interface AppleAuthGlobal {
  init: (config: {
    clientId: string;
    scope: string;
    redirectURI: string;
    state?: string;
    usePopup?: boolean;
  }) => void;
  signIn: () => Promise<{
    authorization: { id_token: string; code?: string; state?: string };
    user?: {
      email?: string;
      name?: { firstName?: string; lastName?: string };
    };
  }>;
}

interface AppleIDGlobal {
  auth: AppleAuthGlobal;
}

interface AppleSignInResult {
  identityToken: string;
  nonce?: string;
  email?: string;
  fullName?: string;
}

interface AppleSignInState {
  available: boolean;
  signIn: () => Promise<AppleSignInResult | null>;
}

function getAppleID(): AppleIDGlobal | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AppleID?: AppleIDGlobal };
  return w.AppleID ?? null;
}

function loadScript(): Promise<void> {
  if (typeof document === "undefined") return Promise.reject(new Error("no dom"));
  if (document.getElementById(SCRIPT_ID)) {
    return getAppleID()
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
          const existing = document.getElementById(SCRIPT_ID);
          existing?.addEventListener("load", () => resolve());
          existing?.addEventListener("error", () => reject(new Error("apple SDK failed to load")));
        });
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.src = APPLE_JS_URL;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("apple SDK failed to load"));
    document.head.appendChild(s);
  });
}

export function useAppleSignIn(): AppleSignInState {
  const clientId = process.env.EXPO_PUBLIC_APPLE_SERVICES_ID ?? "";
  const [available, setAvailable] = useState(() => Boolean(clientId));

  useEffect(() => {
    if (!clientId) {
      setAvailable(false);
      return;
    }
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled) return;
        const appleId = getAppleID();
        if (!appleId) {
          setAvailable(false);
          return;
        }
        appleId.auth.init({
          clientId,
          scope: "name email",
          redirectURI: typeof window !== "undefined" ? window.location.origin : "",
          usePopup: true,
        });
        setAvailable(true);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const signIn = useCallback(async (): Promise<AppleSignInResult | null> => {
    const appleId = getAppleID();
    if (!appleId) return null;
    try {
      const data = await appleId.auth.signIn();
      const idToken = data.authorization?.id_token;
      if (!idToken) return null;
      const result: AppleSignInResult = { identityToken: idToken };
      if (data.user?.email) result.email = data.user.email;
      const given = data.user?.name?.firstName ?? "";
      const family = data.user?.name?.lastName ?? "";
      const fullName = [given, family].filter(Boolean).join(" ").trim();
      if (fullName) result.fullName = fullName;
      return result;
    } catch (e) {
      // Apple's popup-cancel surfaces as { error: "popup_closed_by_user" }.
      const error = (e as { error?: string } | null)?.error;
      if (error === "popup_closed_by_user" || error === "user_cancelled_authorize") {
        return null;
      }
      throw e;
    }
  }, []);

  return { available, signIn };
}
