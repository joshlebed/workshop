// Native timeline scroller.
//
// `ScrollViewContainer` is react-native-reorderable-list's outer scroll host —
// required so the to-do list inside the TODAY block can be a
// `NestedReorderableList` and still autoscroll the feed while dragging. It
// takes a Reanimated scroll handler rather than a plain `onScroll`, which is
// what the sticky date marker reads. Web uses a plain Animated.ScrollView.

import type { ReactElement, ReactNode } from "react";
import type { RefreshControlProps, StyleProp, ViewStyle } from "react-native";
import type { useAnimatedScrollHandler } from "react-native-reanimated";
import { ScrollViewContainer } from "react-native-reorderable-list";

export interface FeedScrollProps {
  onScroll: ReturnType<typeof useAnimatedScrollHandler>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  refreshControl?: ReactElement<RefreshControlProps>;
  children: ReactNode;
  testID?: string;
}

export function FeedScroll({
  onScroll,
  contentContainerStyle,
  refreshControl,
  children,
  testID,
}: FeedScrollProps) {
  return (
    <ScrollViewContainer
      onScroll={onScroll}
      scrollEventThrottle={16}
      contentContainerStyle={contentContainerStyle}
      showsVerticalScrollIndicator={false}
      testID={testID}
      {...(refreshControl ? { refreshControl } : {})}
    >
      {children}
    </ScrollViewContainer>
  );
}
