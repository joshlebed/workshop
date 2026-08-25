// Native pull-to-refresh wrapper.
//
// On iOS / Android we lean on the FlatList / ScrollView's built-in
// `refreshControl` — `react-native-web`'s `RefreshControl` is a no-op
// (`node_modules/react-native-web/dist/exports/RefreshControl/index.js`), so
// we own the web pull gesture in `PullToRefresh.web.tsx` instead.
//
// API contract (both platforms): wrap a single scrollable child (FlatList,
// ScrollView, or one of the gesture-aware list containers like
// `ScrollViewContainer` from react-native-reorderable-list). The wrapper
// clones that child to inject `refreshControl` + always-bounce, so callers
// don't have to repeat the props.

import { tokens } from "@workshop/ui";
import { cloneElement, isValidElement, type ReactElement } from "react";
import { RefreshControl } from "react-native";

export interface PullToRefreshProps {
  refreshing: boolean;
  onRefresh: () => void;
  /**
   * The scrollable list. Must be a single React element that accepts
   * `refreshControl`, `alwaysBounceVertical`, and `overScrollMode` props
   * (FlatList, SectionList, ScrollView, ScrollViewContainer).
   */
  children: ReactElement;
}

export function PullToRefresh({ refreshing, onRefresh, children }: PullToRefreshProps) {
  if (!isValidElement(children)) return children;
  return cloneElement(children, {
    refreshControl: (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={onRefresh}
        tintColor={tokens.accent.default}
        colors={[tokens.accent.default]}
        progressBackgroundColor={tokens.bg.surface}
      />
    ),
    // Always-scrollable + bounce so the pull gesture exists even when the
    // list has fewer rows than the viewport. The user explicitly asked for
    // this behavior across every list.
    alwaysBounceVertical: true,
    overScrollMode: "always",
  } as Partial<Record<string, unknown>>);
}
