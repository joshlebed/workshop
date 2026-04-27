// Web Google Sign In via Google Identity Services. Loads
// https://accounts.google.com/gsi/client lazily and renders an off-screen
// official button that we click programmatically when our visible
// "Continue with Google" button is pressed. The official button is GIS's
// supported imperative entrypoint — `prompt()` (One Tap) is unreliable
// because of its display restrictions.

import { useCallback, useEffect, useRef, useState } from "react";

const GIS_URL = "https://accounts.google.com/gsi/client";
const SCRIPT_ID = "google-gsi-script";

interface GoogleCredentialResponse {
  credential: string;
  select_by?: string;
}

interface GoogleAccountsId {
  initialize: (config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
    use_fedcm_for_prompt?: boolean;
  }) => void;
  prompt: (
    listener?: (notification: {
      isDisplayed?: () => boolean;
      isNotDisplayed?: () => boolean;
      getNotDisplayedReason?: () => string;
      isSkippedMoment?: () => boolean;
      isDismissedMoment?: () => boolean;
    }) => void,
  ) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
  cancel: () => void;
  disableAutoSelect: () => void;
}

interface GoogleGlobal {
  accounts: { id: GoogleAccountsId };
}

export interface GoogleSignInResult {
  idToken: string;
}

export interface GoogleSignInState {
  available: boolean;
  signIn: () => Promise<GoogleSignInResult | null>;
}

function getGoogle(): GoogleGlobal | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { google?: GoogleGlobal };
  return w.google ?? null;
}

function loadScript(): Promise<void> {
  if (typeof document === "undefined") return Promise.reject(new Error("no dom"));
  if (getGoogle()) return Promise.resolve();
  const existing = document.getElementById(SCRIPT_ID);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("GIS failed to load")));
    });
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.src = GIS_URL;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("GIS failed to load"));
    document.head.appendChild(s);
  });
}

export function useGoogleSignIn(): GoogleSignInState {
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";
  const [available, setAvailable] = useState(false);
  // Pending resolver for the in-flight signIn() call. GIS's button click
  // invokes the configured callback with a credential — we route it back
  // through this resolver.
  const resolveRef = useRef<((r: GoogleSignInResult | null) => void) | null>(null);
  const buttonHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!clientId) {
      setAvailable(false);
      return;
    }
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled) return;
        const google = getGoogle();
        if (!google) {
          setAvailable(false);
          return;
        }
        google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            const r = resolveRef.current;
            resolveRef.current = null;
            if (r) r(response.credential ? { idToken: response.credential } : null);
          },
          auto_select: false,
        });

        // Off-screen button host; first click triggers the GIS popup.
        if (!buttonHostRef.current && typeof document !== "undefined") {
          const host = document.createElement("div");
          host.id = "gsi-hidden-button-host";
          host.style.position = "absolute";
          host.style.left = "-9999px";
          host.style.top = "-9999px";
          host.style.opacity = "0";
          host.style.pointerEvents = "none";
          document.body.appendChild(host);
          buttonHostRef.current = host;
          google.accounts.id.renderButton(host, { type: "standard", size: "large" });
        }
        setAvailable(true);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const signIn = useCallback(async (): Promise<GoogleSignInResult | null> => {
    const google = getGoogle();
    if (!google) return null;
    return new Promise<GoogleSignInResult | null>((resolve) => {
      resolveRef.current = resolve;
      const host = buttonHostRef.current;
      // Prefer programmatically clicking the rendered button — GIS handles
      // the popup window flow there. Fall back to prompt() if the host
      // isn't ready (e.g. test stubs that override renderButton with a
      // no-op).
      const inner = host?.querySelector<HTMLElement>("div[role='button'], button, span");
      if (inner) {
        inner.click();
        return;
      }
      google.accounts.id.prompt();
    });
  }, []);

  return { available, signIn };
}
