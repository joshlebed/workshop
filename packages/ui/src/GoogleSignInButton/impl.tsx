// Native variant: renders our styled Button and drives the
// expo-auth-session Google flow via useGoogleSignIn().

import { type GoogleSignInResult, useGoogleSignIn } from "@workshop/api-client/oauth/google";
import { Button } from "../Button";
import { tokens } from "../theme";

export interface GoogleSignInButtonProps {
  onCredential: (result: GoogleSignInResult) => Promise<void> | void;
  onError: (error: Error) => void;
  loading: boolean;
  disabled: boolean;
  /**
   * Draw the edge in `border.control` (3:1, Workshop's control boundary since
   * UX pass 5.5). Off by default: HighScore renders this button too and its
   * look must not move with Workshop's tokens.
   */
  controlBorder?: boolean;
}

// The secondary button's edge before 5.5, kept for HighScore.
const LEGACY_EDGE = { borderColor: tokens.border.default };

export function GoogleSignInButton({
  onCredential,
  onError,
  loading,
  disabled,
  controlBorder = false,
}: GoogleSignInButtonProps) {
  const google = useGoogleSignIn();
  return (
    <Button
      testID="sign-in-google"
      label="Continue with Google"
      variant="secondary"
      size="lg"
      style={controlBorder ? undefined : LEGACY_EDGE}
      loading={loading}
      disabled={disabled || !google.available}
      onPress={async () => {
        try {
          const result = await google.signIn();
          if (!result) return;
          await onCredential(result);
        } catch (e) {
          onError(e instanceof Error ? e : new Error("Google sign-in failed"));
        }
      }}
    />
  );
}
