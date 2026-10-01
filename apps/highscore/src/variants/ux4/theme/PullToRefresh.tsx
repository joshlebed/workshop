// Native pull-to-refresh. `react-native-web`'s RefreshControl is a no-op, so
// the web variant (PullToRefresh.web.tsx) passes the list straight through —
// web already refreshes on a 15s visibility-gated poll.
import { cloneElement, isValidElement, type ReactElement } from "react";
import { RefreshControl } from "react-native";
import { tokens } from "./tokens";

export interface PullToRefreshProps {
  refreshing: boolean;
  onRefresh: () => void;
  /** A single scrollable element that accepts `refreshControl`. */
  children: ReactElement;
}

export function PullToRefresh({ refreshing, onRefresh, children }: PullToRefreshProps) {
  if (!isValidElement(children)) return children;
  return cloneElement(children, {
    refreshControl: (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={onRefresh}
        tintColor={tokens.neon.pink}
        colors={[tokens.neon.pink]}
        progressBackgroundColor={tokens.bg.elevated}
      />
    ),
  } as Partial<Record<string, unknown>>);
}
