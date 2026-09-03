// Web variant, app-owned so the visible button carries HighScore's 2px bezel
// and sharp corners instead of the shared design system's rounded shape.
//
// To match the Apple button visually, we render our own
// styled "Continue with Google" button and stack an invisible Google
// Identity Services iframe on top of it. Clicks land on the GIS iframe
// (which runs Google's real flow); sighted users see only our button.
//
// We can't programmatically click GIS's button (cross-origin iframe), and
// the prompt() fallback uses FedCM which silently hangs for visitors with
// no Google session — so the iframe-overlay approach is the cleanest way
// to keep a real GIS click without giving up the visual.

import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Button } from "../../theme";

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

// GIS rejects width < 200 and clamps width > 400. Anything in between is
// honoured, so we measure the visible button's actual width and pass it
// through (clamped) so the invisible iframe matches the visible button's
// click target as closely as possible.
const GIS_MIN_WIDTH = 200;
const GIS_MAX_WIDTH = 400;

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
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [available, setAvailable] = useState(false);

  // Keep latest callbacks in refs so the GIS init effect doesn't re-run on
  // parent re-renders.
  const onCredentialRef = useRef(onCredential);
  const onErrorRef = useRef(onError);
  onCredentialRef.current = onCredential;
  onErrorRef.current = onError;

  const setOverlay = useCallback((node: View | null) => {
    overlayRef.current = node as unknown as HTMLDivElement | null;
  }, []);
  const setWrapper = useCallback((node: View | null) => {
    wrapperRef.current = node as unknown as HTMLDivElement | null;
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
        const overlay = overlayRef.current;
        const wrapper = wrapperRef.current;
        if (!google || !overlay) {
          setAvailable(false);
          return;
        }
        // Clear any previous render (React strict mode, hot reload).
        while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
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
        const wrapperWidth = wrapper?.getBoundingClientRect().width ?? GIS_MAX_WIDTH;
        const width = Math.min(GIS_MAX_WIDTH, Math.max(GIS_MIN_WIDTH, Math.round(wrapperWidth)));
        google.accounts.id.renderButton(overlay, {
          type: "standard",
          theme: "filled_black",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          logo_alignment: "center",
          width,
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
    <View ref={setWrapper} style={{ position: "relative" }}>
      {/* Visual button — purely cosmetic, click target is the overlay. */}
      <Button
        label="Continue with Google"
        variant="secondary"
        size="lg"
        loading={loading}
        disabled={disabled || !available}
        // Hidden from the a11y tree so screen readers route through the GIS
        // iframe (whose embedded button has its own a11y labels).
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      {/* GIS button: positioned over the visible button, near-invisible so
          clicks (and keyboard activation via the iframe's own focusable
          element) reach Google's real button. Centered horizontally and
          vertically since GIS picks its own height. */}
      <View
        ref={setOverlay}
        testID="sign-in-google"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          // Slightly above zero so browsers register clicks but the iframe
          // doesn't visually compete with the styled button underneath.
          opacity: interactive ? 0.001 : 0,
          pointerEvents: interactive ? "auto" : "none",
        }}
      />
    </View>
  );
}
