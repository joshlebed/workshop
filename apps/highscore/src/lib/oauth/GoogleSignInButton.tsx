// Copied verbatim from apps/workshop/src/lib/oauth/GoogleSignInButton.tsx. Brand-neutral provider
// glue that both apps need; PR-1 extracted the API client but not this layer
// (the .web variants need the packages/*/src/x/index.ts platform-shim shape —
// see CLAUDE.md "Metro does NOT apply .web.ts resolution to a package exports
// target"). Tracked in AGENT-REFLECTIONS.md; keep the two copies in sync until
// then.
// Native variant: renders our styled Button and drives the
// expo-auth-session Google flow via useGoogleSignIn().

import { Button } from "@workshop/ui";
import { type GoogleSignInResult, useGoogleSignIn } from "./google";

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
