// Web keeps Workshop's existing Apple button (UX pass 4.5c): the system
// button has no web implementation and App Review only inspects the binary.
import { Button } from "@workshop/ui";

export interface AppleSignInButtonProps {
  onPress: () => void;
  loading: boolean;
  disabled: boolean;
  testID?: string;
}

export function AppleSignInButton({ onPress, loading, disabled, testID }: AppleSignInButtonProps) {
  return (
    <Button
      testID={testID}
      label="Continue with Apple"
      variant="secondary"
      size="lg"
      loading={loading}
      disabled={disabled}
      onPress={onPress}
    />
  );
}
