// Web variant — no pull gesture. The home queries poll every 15s while the
// tab is visible (`useLivePollingInterval`), so a manual pull buys nothing.
import type { ReactElement } from "react";

export interface PullToRefreshProps {
  refreshing: boolean;
  onRefresh: () => void;
  children: ReactElement;
}

export function PullToRefresh({ children }: PullToRefreshProps) {
  return children;
}
