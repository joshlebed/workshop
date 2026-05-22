import type { Item, LeaderboardEntry } from "@workshop/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTodaysScoresSummary } from "./scoresSummary";

function item(id: string, title: string): Item {
  return {
    id,
    listId: "list-1",
    kind: "plain",
    title,
    url: null,
    note: null,
    content: {} as Item["content"],
    position: null,
    addedBy: "user-1",
    completed: false,
    completedAt: null,
    completedBy: null,
    upvoteCount: 0,
    viewerUpvoted: false,
    createdAt: "2026-05-22T00:00:00Z",
    updatedAt: "2026-05-22T00:00:00Z",
  };
}

function entry(userId: string, scoreRaw: string | null): LeaderboardEntry {
  return {
    userId,
    displayName: null,
    scoreRaw,
    scoreValue: null,
    updatedAt: "2026-05-22T12:00:00Z",
  };
}

describe("buildTodaysScoresSummary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 22, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null with no signed-in user", () => {
    expect(
      buildTodaysScoresSummary({
        listName: "Daily Games",
        items: [item("a", "Wordle")],
        scoresByItem: { a: [entry("me", "4/6")] },
        selfId: null,
        dateKey: "2026-05-22",
      }),
    ).toBeNull();
  });

  it("returns null when the viewer hasn't posted any scores today", () => {
    expect(
      buildTodaysScoresSummary({
        listName: "Daily Games",
        items: [item("a", "Wordle"), item("b", "Connections")],
        scoresByItem: {
          a: [entry("friend", "5/6")],
          b: [entry("friend", "Solved")],
        },
        selfId: "me",
        dateKey: "2026-05-22",
      }),
    ).toBeNull();
  });

  it("includes only the viewer's own scores, in item order, with emoji grids preserved", () => {
    const summary = buildTodaysScoresSummary({
      listName: "Daily Games",
      items: [item("a", "Wordle"), item("b", "Connections"), item("c", "Strands")],
      scoresByItem: {
        a: [entry("friend", "5/6"), entry("me", "Wordle 1,422 4/6\n⬛⬛🟨⬛⬛\n🟩🟩🟩🟩🟩")],
        b: [entry("me", "Puzzle #399\n🟪🟪🟪🟪")],
        c: [entry("friend", "Strands #1\n🔵🔵🔵🟡")],
      },
      selfId: "me",
      dateKey: "2026-05-22",
    });
    expect(summary).toBe(
      [
        "Daily Games — Today",
        "",
        "Wordle",
        "Wordle 1,422 4/6\n⬛⬛🟨⬛⬛\n🟩🟩🟩🟩🟩",
        "",
        "Connections",
        "Puzzle #399\n🟪🟪🟪🟪",
      ].join("\n"),
    );
  });

  it("skips items whose scoreRaw is blank or whitespace", () => {
    const summary = buildTodaysScoresSummary({
      listName: "Daily Games",
      items: [item("a", "Wordle"), item("b", "Connections")],
      scoresByItem: {
        a: [entry("me", "   ")],
        b: [entry("me", "Solved")],
      },
      selfId: "me",
      dateKey: "2026-05-22",
    });
    expect(summary).toBe(["Daily Games — Today", "", "Connections", "Solved"].join("\n"));
  });

  it("uses the date-key label in the header for older days", () => {
    const summary = buildTodaysScoresSummary({
      listName: "Daily Games",
      items: [item("a", "Wordle")],
      scoresByItem: { a: [entry("me", "4/6")] },
      selfId: "me",
      dateKey: "2026-05-21",
    });
    expect(summary?.startsWith("Daily Games — Yesterday\n\n")).toBe(true);
  });
});
