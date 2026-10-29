import type { CatalogGame, DiscoveryGame, Game } from "@workshop/shared/games";
import { describe, expect, it } from "vitest";
import {
  allGamesRows,
  friendsFeedRows,
  friendsPlayLine,
  groupCatalogRows,
  playerCountLine,
} from "./catalogSections";

function game(id: string, gameKey: string | null, title = id): Game {
  return {
    id,
    url: `https://${id}.example.com`,
    normalizedUrl: `${id}.example.com`,
    title,
    iconUrl: null,
    gameKey,
    scoreDirection: "desc",
    scoreSpec: null,
    summarySpec: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("groupCatalogRows", () => {
  it("sections by registry category in display order, unknown games last, keeping row order", () => {
    const rows = [
      { game: game("g1", "wordle"), subtitle: null, inMyGames: false },
      { game: game("g2", null), subtitle: null, inMyGames: false },
      { game: game("g3", "globle"), subtitle: null, inMyGames: true },
      { game: game("g4", "connections"), subtitle: null, inMyGames: false },
    ];
    const sections = groupCatalogRows(rows);
    expect(sections.map((s) => [s.category, s.title, s.data.map((r) => r.game.id)])).toEqual([
      ["words", "Word games", ["g1", "g4"]],
      ["geography", "Geography", ["g3"]],
      ["other", "Other", ["g2"]],
    ]);
  });

  it("drops empty categories", () => {
    expect(groupCatalogRows([])).toEqual([]);
  });
});

describe("row builders", () => {
  it("friendsPlayLine names up to two friends", () => {
    expect(friendsPlayLine([])).toBeNull();
    expect(friendsPlayLine([{ displayName: "Sam" }])).toBe("Sam plays");
    expect(friendsPlayLine([{ displayName: "Sam" }, { displayName: null }])).toBe(
      "Sam & Someone play",
    );
    expect(
      friendsPlayLine([{ displayName: "Sam" }, { displayName: "Alex" }, { displayName: "Q" }]),
    ).toBe("Sam, Alex +1 play");
  });

  it("playerCountLine pluralizes", () => {
    expect(playerCountLine(0)).toBe("No players yet");
    expect(playerCountLine(1)).toBe("1 player");
    expect(playerCountLine(12)).toBe("12 players");
  });

  it("friendsFeedRows and allGamesRows produce one subtitle per row", () => {
    const dg: DiscoveryGame = {
      game: game("d", "wordle"),
      friends: [{ userId: "u1", displayName: "Sam" }],
      inMyGames: true,
    };
    expect(friendsFeedRows([dg])[0]).toMatchObject({ subtitle: "Sam plays", inMyGames: true });
    const cg: CatalogGame = {
      game: game("c", null),
      playerCount: 3,
      friends: [],
      inMyGames: false,
    };
    expect(allGamesRows([cg])[0]?.subtitle).toBe("3 players");
    expect(allGamesRows([{ ...cg, friends: dg.friends }])[0]?.subtitle).toBe(
      "3 players · Sam plays",
    );
  });
});
