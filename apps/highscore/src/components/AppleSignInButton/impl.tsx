// Native Sign in with Apple button. App Store Review rejected HighScore 1.0 (9)
// under Guideline 4 because the Apple button was our own styled `Button` —
// the logo has to be Apple's own artwork. `AppleAuthenticationButton` is
// rendered by the system (`ASAuthorizationAppleIDButton`), so the logo,
// corner treatment and label are exactly what the HIG specifies. Keep it
// here, not in `@workshop/ui`: Workshop's sign-in is separately approved and
// must not change under a HighScore fix.

import * as AppleAuthentication from "expo-apple-authentication";
import { ActivityIndicator, StyleSheet, View } from "react-native";

export interface AppleSignInButtonProps {
  onPress: () => void;
  loading: boolean;
  disabled: boolean;
  testID?: string;
}

const HEIGHT = 52;

export function AppleSignInButton({ onPress, loading, disabled, testID }: AppleSignInButtonProps) {
  return (
    <View
      style={[styles.wrap, disabled && !loading ? styles.dimmed : null]}
      pointerEvents={disabled || loading ? "none" : "auto"}
      testID={testID}
    >
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
        cornerRadius={12}
        style={styles.button}
        onPress={onPress}
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
  spinner: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.7)",
    borderRadius: 12,
  },
});
