import type { FriendSummary } from "@workshop/shared/friends";
import type { Game, GameStandingsEntry, MyGame } from "@workshop/shared/games";
import { describe, expect, it } from "vitest";
import { buildPlayerRows, cellGlyph, gameStandingCells, pickLeader, scoreMark } from "./matrix";

function game(id: string, title: string): Game {
  return {
    id,
    url: `https://${id}.example.com`,
    normalizedUrl: `${id}.example.com`,
    title,
    iconUrl: null,
    gameKey: null,
    scoreDirection: "asc",
    scoreSpec: null,
    summarySpec: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function entry(
  userId: string,
  displayName: string,
  scoreRaw: string | null,
  rank: number | null,
  scoreValue: number | null = leadingNumber(scoreRaw),
): GameStandingsEntry {
  return {
    userId,
    displayName,
    scoreRaw,
    scoreValue,
    rank,
    updatedAt: "2026-01-01T00:00:00.000Z",
    reactions: [],
  };
}

/** Stand-in for the backend parser: the first number in the share. */
function leadingNumber(raw: string | null): number | null {
  const match = raw?.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function myGame(id: string, title: string, entries: GameStandingsEntry[]): MyGame {
  return {
    gameId: id,
    position: 0,
    addedAt: "2026-01-01T00:00:00.000Z",
    game: game(id, title),
    standings: { periodKey: "2026-01-01", entries, viewerHasPlayed: false, viewerStreak: 0 },
  };
}

const friend = (userId: string, displayName: string): FriendSummary => ({
  userId,
  displayName,
  friendsSince: "2026-01-01T00:00:00.000Z",
});

describe("cellGlyph", () => {
  it("keeps a guess fraction", () => {
    expect(cellGlyph("Wordle 1,234 4/6")).toBe("4/6");
  });

  it("keeps a clock time", () => {
    expect(cellGlyph("solved in 2:11")).toBe("2:11");
  });

  it("falls back to the first short number", () => {
    expect(cellGlyph("Score: 418 points")).toBe("418");
  });

  it("keeps a short non-numeric mark verbatim", () => {
    expect(cellGlyph("WIN")).toBe("WIN");
  });

  it("returns null for a body with nothing short enough to show", () => {
    expect(cellGlyph("absolutely enormous unreadable share text")).toBeNull();
    expect(cellGlyph(null)).toBeNull();
    expect(cellGlyph("   ")).toBeNull();
  });

  it("reads only the first line", () => {
    expect(cellGlyph("3/6\n🟩🟩🟩")).toBe("3/6");
  });
});

describe("scoreMark", () => {
  it("keeps the fraction when it carries the parsed value", () => {
    expect(scoreMark({ scoreValue: 4 }, "Wordle 1,234 4/6")).toBe("4/6");
  });

  it("prefers the parsed value when the human mark disagrees with it", () => {
    // MapTap shares lead with a per-round score; the rank is on the total.
    expect(scoreMark({ scoreValue: 988 }, "99🎯 97🔥\nFinal score: 988")).toBe("988");
  });

  it("falls back to the human mark when nothing was parsed", () => {
    expect(scoreMark({ scoreValue: null }, "solved in 2:11")).toBe("2:11");
    expect(scoreMark({ scoreValue: null }, null)).toBeNull();
  });
});

describe("buildPlayerRows", () => {
  const games = [
    myGame("g1", "Wordle", [entry("me", "Josh", "3/6", 1), entry("a", "Alex", "4/6", 2)]),
    myGame("g2", "Tradle", [entry("a", "Alex", "1/6", 1)]),
  ];

  it("pins the viewer first even when they played less than everyone else", () => {
    const rows = buildPlayerRows({
      games,
      friends: [friend("a", "Alex")],
      selfId: "me",
      selfName: "Josh",
    });
    expect(rows.map((r) => r.userId)).toEqual(["me", "a"]);
    expect(rows[0]?.isSelf).toBe(true);
  });

  it("gives every game a cell, empty where the player didn't post", () => {
    const rows = buildPlayerRows({
      games,
      friends: [friend("a", "Alex")],
      selfId: "me",
      selfName: "Josh",
    });
    const mine = rows.find((r) => r.userId === "me");
    expect(mine?.cells.map((c) => c.played)).toEqual([true, false]);
    expect(mine?.cells[0]?.glyph).toBe("3/6");
    expect(mine?.cells[1]?.body).toBeNull();
    expect(mine?.playedCount).toBe(1);
  });

  it("gives a friend who hasn't played today an all-empty row", () => {
    const rows = buildPlayerRows({
      games,
      friends: [friend("a", "Alex"), friend("z", "Zoe")],
      selfId: "me",
      selfName: "Josh",
    });
    const zoe = rows.find((r) => r.userId === "z");
    expect(zoe).toBeDefined();
    expect(zoe?.playedCount).toBe(0);
    expect(zoe?.cells).toHaveLength(2);
    // …and sorts below everyone who did play.
    expect(rows.at(-1)?.userId).toBe("z");
  });

  it("crowns the player with the most outright firsts", () => {
    const rows = buildPlayerRows({
      games,
      friends: [friend("a", "Alex")],
      selfId: "me",
      selfName: "Josh",
    });
    expect(rows.find((r) => r.isLeader)?.userId).toBe("a");
    expect(rows.filter((r) => r.isLeader)).toHaveLength(1);
  });

  it("computes mean rank across played games only", () => {
    const rows = buildPlayerRows({
      games,
      friends: [friend("a", "Alex")],
      selfId: "me",
      selfName: "Josh",
    });
    expect(rows.find((r) => r.userId === "a")?.avgRank).toBeCloseTo(1.5);
    expect(rows.find((r) => r.userId === "me")?.avgRank).toBe(1);
  });

  it("treats an entry with no raw score as unplayed", () => {
    const rows = buildPlayerRows({
      games: [myGame("g1", "Wordle", [entry("a", "Alex", null, null)])],
      friends: [friend("a", "Alex")],
      selfId: "me",
      selfName: "Josh",
    });
    expect(rows.find((r) => r.userId === "a")?.playedCount).toBe(0);
  });
});

describe("pickLeader", () => {
  const base = { cells: [], avgRank: null, isSelf: false, isLeader: false, displayName: null };

  it("returns null when nobody won anything", () => {
    expect(pickLeader([{ ...base, userId: "a", playedCount: 2, firsts: 0 }])).toBeNull();
  });

  it("breaks a firsts tie on games played", () => {
    const winner = pickLeader([
      { ...base, userId: "a", playedCount: 1, firsts: 1 },
      { ...base, userId: "b", playedCount: 3, firsts: 1 },
    ]);
    expect(winner).toBe("b");
  });

  it("breaks a played tie on mean rank", () => {
    const winner = pickLeader([
      { ...base, userId: "a", playedCount: 2, firsts: 1, avgRank: 2.5 },
      { ...base, userId: "b", playedCount: 2, firsts: 1, avgRank: 1.5 },
    ]);
    expect(winner).toBe("b");
  });

  it("crowns nobody on a dead heat", () => {
    const winner = pickLeader([
      { ...base, userId: "a", playedCount: 2, firsts: 1, avgRank: 1.5 },
      { ...base, userId: "b", playedCount: 2, firsts: 1, avgRank: 1.5 },
    ]);
    expect(winner).toBeNull();
  });
});

describe("gameStandingCells", () => {
  it("keeps server rank order and flags the viewer", () => {
    const cells = gameStandingCells(
      myGame("g1", "Wordle", [entry("me", "Josh", "3/6", 1), entry("a", "Alex", "4/6", 2)]),
      "me",
    );
    expect(cells.map((c) => c.userId)).toEqual(["me", "a"]);
    expect(cells[0]?.isSelf).toBe(true);
    expect(cells[1]?.isSelf).toBe(false);
    expect(cells[0]?.glyph).toBe("3/6");
  });

  it("drops entries with no posted result", () => {
    const cells = gameStandingCells(myGame("g1", "Wordle", [entry("a", "Alex", null, null)]), "me");
    expect(cells).toHaveLength(0);
  });
});
