// Native Sign in with Apple button. App Store Review rejected HighScore 1.0 (9)
// under Guideline 4 because the Apple button was our own styled `Button` —
// the logo has to be Apple's own artwork. `AppleAuthenticationButton` is
// rendered by the system (`ASAuthorizationAppleIDButton`), so the logo,
// corner treatment and label are exactly what the HIG specifies. Keep it
// here, not in `@workshop/ui`: Workshop's sign-in is separately approved and
// must not change under a HighScore fix.
//
// The tap is handled by a transparent `Pressable` laid over the native view,
// not by the native button's own `onPress`. Review of 1.0.1 (13) on iOS 27
// found "Continue with Apple" did nothing: the reviewer's device never reached
// `/v1/auth/apple`, while the same device completed Apple sign-in on 1.0 (9),
// whose tap went straight to `signInAsync` from a plain `Pressable`. So the
// native button's `onButtonPress` event is the only link that broke. Driving
// `signInAsync` from our own touch handler (the exact path 1.0 (9) used) keeps
// Apple's artwork and removes that dependency; the native `onPress` stays wired
// as a fallback, de-duplicated by a short timestamp guard.

import * as AppleAuthentication from "expo-apple-authentication";
import { useCallback, useRef } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

export interface AppleSignInButtonProps {
  onPress: () => void;
  loading: boolean;
  disabled: boolean;
  testID?: string;
}

const HEIGHT = 52;
/** Both the overlay and the native button can fire for one tap; keep the first. */
const DEDUPE_MS = 600;

export function AppleSignInButton({ onPress, loading, disabled, testID }: AppleSignInButtonProps) {
  const inert = disabled || loading;
  const lastFiredAt = useRef(0);
  const fire = useCallback(() => {
    const now = Date.now();
    if (now - lastFiredAt.current < DEDUPE_MS) return;
    lastFiredAt.current = now;
    onPress();
  }, [onPress]);

  return (
    <View style={[styles.wrap, disabled && !loading ? styles.dimmed : null]}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
        cornerRadius={12}
        style={styles.button}
        onPress={fire}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Continue with Apple"
        accessibilityState={{ disabled: inert, busy: loading }}
        onPress={inert ? undefined : fire}
        testID={testID}
        style={({ pressed }) => [styles.overlay, pressed && !inert ? styles.overlayPressed : null]}
      />
      {loading ? (
        <View style={styles.spinner} pointerEvents="none">
          <ActivityIndicator color="#000000" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", height: HEIGHT },
  dimmed: { opacity: 0.5 },
  button: { width: "100%", height: HEIGHT },
  overlay: { ...StyleSheet.absoluteFillObject, borderRadius: 12 },
  overlayPressed: { backgroundColor: "rgba(0,0,0,0.08)" },
  spinner: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.7)",
    borderRadius: 12,
  },
});
