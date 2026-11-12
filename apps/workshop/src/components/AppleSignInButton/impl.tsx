// Native Sign in with Apple button (UX pass 4.5c). App Review requires
// Apple's own artwork (Guideline 4); `AppleAuthenticationButton` is drawn by
// the system (`ASAuthorizationAppleIDButton`). HighScore was rejected for a
// hand-drawn button and fixed it in `apps/highscore/src/components/
// AppleSignInButton`; this is Workshop's own copy of that approach (the apps
// never share presentation code).
//
// The tap goes through a transparent `Pressable` over the native view, the
// same path HighScore settled on after the native `onButtonPress` event went
// missing on iOS 27; the native `onPress` stays wired as a fallback, with a
// short guard so one tap fires once. `expo-apple-authentication` is already
// a Workshop native dependency, so this adds no native module.

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
const RADIUS = 14;
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
        cornerRadius={RADIUS}
        style={styles.button}
        onPress={inert ? () => {} : fire}
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
          <ActivityIndicator color="#1F1B17" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", height: HEIGHT },
  dimmed: { opacity: 0.5 },
  button: { width: "100%", height: HEIGHT },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: RADIUS },
  overlayPressed: { backgroundColor: "rgba(14,12,11,0.08)" },
  spinner: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(254,252,250,0.7)",
    borderRadius: RADIUS,
  },
});
