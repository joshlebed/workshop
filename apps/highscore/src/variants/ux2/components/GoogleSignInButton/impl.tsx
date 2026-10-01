// HighScore-owned copy of the shared Google sign-in button. It exists so the
// provider buttons on `/sign-in` share one bezel and one label treatment
// instead of pairing a themed Apple button with a Workshop-styled Google one.
// Behaviour is unchanged from `@workshop/ui`; only the Button and the tokens
// come from the app theme.
// Native variant: renders our styled Button and drives the
// expo-auth-session Google flow via useGoogleSignIn().

import { type GoogleSignInResult, useGoogleSignIn } from "@workshop/api-client/oauth/google";
import { Button } from "../../theme";

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
  const google = useGoogleSignIn();
  return (
    <Button
      testID="sign-in-google"
      label="Continue with Google"
      variant="secondary"
      size="lg"
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
