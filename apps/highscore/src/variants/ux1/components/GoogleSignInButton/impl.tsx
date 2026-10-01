// Native variant — HighScore's own Button over the shared expo-auth-session
// Google flow. App-owned because the shared `@workshop/ui` button carries
// Workshop's rounded, non-bezelled shape (DESIGN.md: no visual token may come
// from @workshop/ui).

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
