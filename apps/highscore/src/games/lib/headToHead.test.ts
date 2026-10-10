import type { GamesResponse, MyGame } from "@workshop/shared/games";
import { describe, expect, it } from "vitest";
import { headToHead } from "./headToHead";

function game(
  id: string,
  entries: { userId: string; rank: number | null; scoreRaw: string | null }[],
): MyGame {
  return {
    gameId: id,
    position: null,
    addedAt: "",
    game: {
      id,
      url: "",
      normalizedUrl: "",
      title: id,
      iconUrl: null,
      gameKey: null,
      scoreDirection: "desc",
      scoreSpec: null,
      summarySpec: null,
      createdAt: "",
    },
    standings: {
      periodKey: "2026-10-07",
      viewerHasPlayed: true,
      viewerStreak: 0,
      entries: entries.map((e) => ({
        ...e,
        displayName: e.userId,
        scoreValue: null,
        updatedAt: null,
        reactions: [],
      })),
    },
  };
}

const label = () => "x";

describe("headToHead", () => {
  it("counts only games both posted and tallies wins/losses/ties", () => {
    const data: GamesResponse = {
      periodKey: "2026-10-07",
      games: [
        game("a", [
          { userId: "me", rank: 1, scoreRaw: "1" },
          { userId: "them", rank: 2, scoreRaw: "2" },
        ]),
        game("b", [
          { userId: "me", rank: 3, scoreRaw: "1" },
          { userId: "them", rank: 1, scoreRaw: "2" },
        ]),
        game("c", [
          { userId: "me", rank: 1, scoreRaw: "1" },
          { userId: "them", rank: 1, scoreRaw: "2" },
        ]),
        game("d", [{ userId: "me", rank: 1, scoreRaw: "1" }]),
        game("e", [
          { userId: "me", rank: null, scoreRaw: "" },
          { userId: "them", rank: 1, scoreRaw: "2" },
        ]),
      ],
    };
    const h = headToHead(data, "me", "them", label);
    expect(h.games.map((g) => [g.gameId, g.leader])).toEqual([
      ["a", "me"],
      ["b", "them"],
      ["c", "tie"],
    ]);
    expect(h).toMatchObject({ wins: 1, losses: 1, ties: 1 });
  });

  it("treats an unranked row against a ranked one as a loss for the unranked side", () => {
    const data: GamesResponse = {
      periodKey: "2026-10-07",
      games: [
        game("a", [
          { userId: "me", rank: null, scoreRaw: "??" },
          { userId: "them", rank: 1, scoreRaw: "2" },
        ]),
      ],
    };
    expect(headToHead(data, "me", "them", label).losses).toBe(1);
    expect(headToHead(undefined, "me", "them", label).games).toEqual([]);
  });
});
