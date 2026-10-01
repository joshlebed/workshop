// Web timeline scroller. react-native-reorderable-list has no web
// implementation (the to-do list uses @dnd-kit there), so this is a plain
// Animated.ScrollView with the same prop shape as the native variant.
//
// No pull-to-refresh on web: the feed polls every 15s while the tab is visible
// (`useLivePollingInterval`) and refetches on focus, so a hand-built pull
// gesture would only duplicate what already happens.

import type { ReactElement, ReactNode } from "react";
import type { RefreshControlProps, StyleProp, ViewStyle } from "react-native";
import Animated, { type useAnimatedScrollHandler } from "react-native-reanimated";

export interface FeedScrollProps {
  onScroll: ReturnType<typeof useAnimatedScrollHandler>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  refreshControl?: ReactElement<RefreshControlProps>;
  children: ReactNode;
  testID?: string;
}

export function FeedScroll({ onScroll, contentContainerStyle, children, testID }: FeedScrollProps) {
  return (
    <Animated.ScrollView
      onScroll={onScroll}
      scrollEventThrottle={16}
      contentContainerStyle={contentContainerStyle}
      showsVerticalScrollIndicator={false}
      testID={testID}
    >
      {children}
    </Animated.ScrollView>
  );
}
