// Native to-do list — long-press a row to reorder My Games.
//
// `NestedReorderableList` + `scrollable={false}` is the library's supported
// shape for a reorderable list living inside another scroll view; the outer
// scroller is the `ScrollViewContainer` that `FeedScroll.tsx` renders on
// native. Web has its own implementation (`TodoList.web.tsx`).

import type { MyGame } from "@workshop/shared/games";
import { haptics } from "@workshop/ui";
import { memo } from "react";
import { Pressable } from "react-native";
import {
  NestedReorderableList,
  type ReorderableListReorderEvent,
  useIsActive,
  useReorderableDrag,
} from "react-native-reorderable-list";
import type { TodoListProps } from "./todoListProps";

export function TodoList({ games, renderRow, onReorder }: TodoListProps) {
  return (
    <NestedReorderableList
      data={games}
      scrollable={false}
      keyExtractor={keyExtractor}
      renderItem={({ item }: { item: MyGame }) => <DraggableRow game={item} render={renderRow} />}
      onReorder={({ from, to }: ReorderableListReorderEvent) =>
        onReorder({ fromIndex: from, toIndex: to })
      }
      testID="today-todo-list"
      shouldUpdateActiveItem
    />
  );
}

function keyExtractor(game: MyGame): string {
  return game.gameId;
}

const DraggableRow = memo(function DraggableRow({
  game,
  render,
}: {
  game: MyGame;
  render: TodoListProps["renderRow"];
}) {
  const drag = useReorderableDrag();
  const isActive = useIsActive();
  const onLongPressBody = () => {
    haptics.selection();
    drag();
  };
  return (
    <Pressable onLongPress={onLongPressBody} delayLongPress={250} accessible={false}>
      {render(game, isActive, onLongPressBody)}
    </Pressable>
  );
});
