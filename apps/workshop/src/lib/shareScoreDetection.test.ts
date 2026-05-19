import type { Item, ListSummary } from "@workshop/shared";
import { describe, expect, it } from "vitest";
import {
  detectSharedScore,
  flattenListItems,
  pickSuggestedScoreTarget,
} from "./shareScoreDetection";

describe("detectSharedScore", () => {
  it("detects MapTap score text", () => {
    expect(detectSharedScore("MapTap\nScore 42")?.kind).toBe("maptap");
    expect(detectSharedScore("maptap result")?.gameLabel).toBe("MapTap");
  });

  it("ignores non-score share text", () => {
    expect(detectSharedScore("https://example.com/movie")).toBeNull();
  });
});

describe("pickSuggestedScoreTarget", () => {
  it("picks the most recently updated matching game from leaderboard lists", () => {
    const oldList = makeList("list-old", "Older games", "2026-05-10T12:00:00.000Z");
    const newList = makeList("list-new", "Newer games", "2026-05-11T12:00:00.000Z");
    const oldItem = makeItem("item-old", oldList.id, "MapTap", "2026-05-12T12:00:00.000Z");
    const newItem = makeItem("item-new", newList.id, "MapTap", "2026-05-13T12:00:00.000Z");

    const target = pickSuggestedScoreTarget(detectSharedScore("maptap 11"), [oldList, newList], {
      [oldList.id]: [oldItem],
      [newList.id]: [newItem],
    });

    expect(target?.list.id).toBe(newList.id);
    expect(target?.item.id).toBe(newItem.id);
  });

  it("does not suggest games from lists without leaderboard enabled", () => {
    const list = makeList("list", "Links", "2026-05-10T12:00:00.000Z", []);
    const item = makeItem("item", list.id, "MapTap", "2026-05-12T12:00:00.000Z");

    expect(
      pickSuggestedScoreTarget(detectSharedScore("maptap 11"), [list], { [list.id]: [item] }),
    ).toBeNull();
  });
});

describe("flattenListItems", () => {
  it("preserves ordered, unordered, completed section order", () => {
    const a = makeItem("a", "list", "A", "2026-05-12T12:00:00.000Z");
    const b = makeItem("b", "list", "B", "2026-05-12T12:00:00.000Z");
    const c = makeItem("c", "list", "C", "2026-05-12T12:00:00.000Z");

    expect(
      flattenListItems({ ordered: [a], unordered: [b], completed: [c] }).map((i) => i.id),
    ).toEqual(["a", "b", "c"]);
  });
});

function makeList(
  id: string,
  name: string,
  updatedAt: string,
  modules: ListSummary["modules"] = ["leaderboard"],
): ListSummary {
  return {
    id,
    name,
    emoji: "G",
    color: "sunset",
    description: null,
    coverPhotoUrl: null,
    ownerId: "user",
    itemKind: "link",
    modules,
    createdAt: "2026-05-01T12:00:00.000Z",
    updatedAt,
    role: "owner",
    itemCount: 1,
    memberCount: 1,
    unreadCount: 0,
    pinnedAt: null,
    archivedAt: null,
    mutedAt: null,
  };
}

function makeItem(id: string, listId: string, title: string, updatedAt: string): Item {
  return {
    id,
    listId,
    kind: "link",
    title,
    url: null,
    note: null,
    content: {},
    position: null,
    addedBy: "user",
    completed: false,
    completedAt: null,
    completedBy: null,
    upvoteCount: 0,
    viewerUpvoted: false,
    createdAt: "2026-05-01T12:00:00.000Z",
    updatedAt,
  };
}
