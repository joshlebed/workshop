import type { ReactNode } from "react";

/**
 * The desktop two-pane layout (UX pass 5.7c) is web-only. On native the
 * shell is a pass-through and no screen is ever in a pane.
 */
export function TwoPaneShell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** True while the lists sidebar is showing beside the current screen. */
export function useTwoPane(): boolean {
  return false;
}
