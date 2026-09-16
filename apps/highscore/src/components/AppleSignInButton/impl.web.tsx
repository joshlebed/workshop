// Web variant: Apple's HIG-shaped button drawn with the Apple logo glyph from
// the system font. `expo-apple-authentication`'s native button has no web
// implementation, and App Review only inspects the iOS binary — but keeping
// the web button on-spec (black-on-white, logo left of the label) means the
// two surfaces match.

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

export interface AppleSignInButtonProps {
  onPress: () => void;
  loading: boolean;
  disabled: boolean;
  testID?: string;
}

const HEIGHT = 52;

export function AppleSignInButton({ onPress, loading, disabled, testID }: AppleSignInButtonProps) {
  const inert = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Continue with Apple"
      onPress={inert ? undefined : onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        pressed && !inert ? styles.pressed : null,
        disabled && !loading ? styles.dimmed : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#000000" />
      ) : (
        <View style={styles.row}>
          <AppleLogo />
          <Text style={styles.label}>Continue with Apple</Text>
        </View>
      )}
    </Pressable>
  );
}

/** Apple logo — the Private Use Area glyph every Apple system font ships. */
function AppleLogo() {
  return (
    <Text style={styles.logo} accessibilityElementsHidden>
      {""}
    </Text>
  );
}

const styles = StyleSheet.create({
  button: {
    width: "100%",
    height: HEIGHT,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { backgroundColor: "#E5E5E5" },
  dimmed: { opacity: 0.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  logo: {
    color: "#000000",
    fontSize: 22,
    lineHeight: 26,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif",
  },
  label: {
    color: "#000000",
    fontSize: 17,
    fontWeight: "600",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif",
  },
});
