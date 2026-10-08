import type { GameStandingsEntry, MyGame } from "@workshop/shared/games";
import { describe, expect, it } from "vitest";
import { dayScorecard, groupRows, placingLabel, rowSummary, shortName } from "./dayRows";

function entry(userId: string, rank: number | null, scoreRaw = "x"): GameStandingsEntry {
  return {
    userId,
    displayName: userId,
    scoreRaw,
    scoreValue: rank,
    rank,
    updatedAt: "2026-10-08T00:00:00Z",
    reactions: [],
  };
}

function game(id: string, entries: GameStandingsEntry[], viewerStreak = 0): MyGame {
  return {
    gameId: id,
    position: null,
    addedAt: "",
    game: {
      id,
      url: `https://${id}.test`,
      normalizedUrl: `${id}.test`,
      title: id,
      iconUrl: null,
      gameKey: null,
      scoreDirection: "asc",
      scoreSpec: null,
      summarySpec: null,
      createdAt: "",
    },
    standings: {
      periodKey: "2026-10-08",
      entries,
      viewerHasPlayed: entries.some((e) => e.userId === "me"),
      viewerStreak,
    },
  };
}

describe("rowSummary", () => {
  it("finds my entry, the leader and the others", () => {
    const row = rowSummary(game("g", [entry("a", 2), entry("me", 1), entry("b", 3)]), "me");
    expect(row.mine?.userId).toBe("me");
    expect(row.leader?.userId).toBe("me");
    expect(row.playerCount).toBe(3);
    expect(row.others.map((e) => e.userId)).toEqual(["a", "b"]);
    expect(row.isWin).toBe(true);
    expect(row.isTie).toBe(false);
  });

  it("ignores phantom rows with no text and does not count a solo rank 1 as a win", () => {
    const row = rowSummary(game("g", [entry("me", 1), entry("ghost", null, "")]), "me");
    expect(row.playerCount).toBe(1);
    expect(row.isWin).toBe(false);
  });

  it("flags a shared first place as a tie", () => {
    const row = rowSummary(game("g", [entry("me", 1), entry("a", 1)]), "me");
    expect(row.isWin).toBe(false);
    expect(row.isTie).toBe(true);
  });
});

describe("dayScorecard + groupRows", () => {
  const games = [
    game("won", [entry("me", 1), entry("a", 2)], 4),
    game("lost", [entry("a", 1), entry("me", 2)], 1),
    game("todo", [entry("a", 1)]),
    game("quiet", []),
  ];

  it("counts plays, wins and the best live streak", () => {
    expect(dayScorecard(games, "me")).toEqual({
      played: 2,
      total: 4,
      wins: 1,
      bestStreak: { title: "won", days: 4 },
      anyPlays: true,
    });
  });

  it("splits to-play from played, keeping order inside each", () => {
    const grouped = groupRows(games, "me");
    expect(grouped.toPlay.map((g) => g.gameId)).toEqual(["todo", "quiet"]);
    expect(grouped.played.map((g) => g.gameId)).toEqual(["won", "lost"]);
  });
});

describe("labels", () => {
  it("prints a placing or a fallback", () => {
    expect(placingLabel(rowSummary(game("g", [entry("me", 2), entry("a", 1)]), "me"))).toBe(
      "#2 of 2",
    );
    expect(placingLabel(rowSummary(game("g", []), "me"))).toBeNull();
  });

  it("shortens names to a first name", () => {
    expect(shortName("Renata Hoh")).toBe("Renata");
    expect(shortName(null)).toBe("Someone");
  });
});
