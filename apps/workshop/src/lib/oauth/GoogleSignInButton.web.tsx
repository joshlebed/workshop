// Web variant: renders the official Google Identity Services button
// directly. The previous approach (render GIS into a hidden host, then
// programmatically click it from our own styled button) is broken — the
// rendered button lives in a cross-origin iframe so the inner querySelector
// finds nothing, and the fall-back `prompt()` path uses FedCM which hangs
// silently when the visitor has no Google session. Showing the real button
// is what Google supports, and it works for both FedCM and the legacy
// popup flow.

import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";

// Local copy of the shape returned by the native flow — kept inline so this
// web-only file doesn't pull in the native module graph (expo-auth-session).
interface GoogleSignInResult {
  idToken: string;
}

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
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
  cancel: () => void;
  disableAutoSelect: () => void;
}

interface GoogleGlobal {
  accounts: { id: GoogleAccountsId };
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

export interface GoogleSignInButtonProps {
  onCredential: (result: GoogleSignInResult) => Promise<void> | void;
  onError: (error: Error) => void;
  loading: boolean;
  disabled: boolean;
}

export function GoogleSignInButton({
  onCredential,
  onError,
  loading,
  disabled,
}: GoogleSignInButtonProps) {
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [available, setAvailable] = useState(false);

  // Keep the latest callbacks in refs so the GIS init effect doesn't have to
  // re-run when the parent re-renders with new closures.
  const onCredentialRef = useRef(onCredential);
  const onErrorRef = useRef(onError);
  onCredentialRef.current = onCredential;
  onErrorRef.current = onError;

  const setHost = useCallback((node: View | null) => {
    // react-native-web's View ref points at the underlying DOM element.
    hostRef.current = node as unknown as HTMLDivElement | null;
  }, []);

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
        const host = hostRef.current;
        if (!google || !host) {
          setAvailable(false);
          return;
        }
        // Clear any previous render (e.g. from React strict mode double-invoke).
        while (host.firstChild) host.removeChild(host.firstChild);
        google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            if (!response.credential) {
              onErrorRef.current(new Error("Google returned no credential"));
              return;
            }
            void Promise.resolve(onCredentialRef.current({ idToken: response.credential })).catch(
              (e: unknown) => {
                onErrorRef.current(e instanceof Error ? e : new Error(String(e)));
              },
            );
          },
          auto_select: false,
          use_fedcm_for_prompt: false,
        });
        google.accounts.id.renderButton(host, {
          type: "standard",
          theme: "filled_black",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          logo_alignment: "left",
          width: 320,
        });
        setAvailable(true);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setAvailable(false);
        onErrorRef.current(e instanceof Error ? e : new Error(String(e)));
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const interactive = available && !loading && !disabled;
  return (
    <View
      ref={setHost}
      testID="sign-in-google"
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      // GIS's button is a fixed-size iframe; centre it and give the row a
      // predictable height so the layout matches the neighbouring buttons.
      style={{
        minHeight: 44,
        alignSelf: "center",
        // Suppress interaction while the parent is busy with another flow.
        opacity: disabled || loading ? 0.5 : 1,
        pointerEvents: interactive ? "auto" : "none",
      }}
    />
  );
}
