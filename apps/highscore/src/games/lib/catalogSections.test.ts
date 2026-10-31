import type { CatalogGame, DiscoveryGame, Game } from "@workshop/shared/games";
import { describe, expect, it } from "vitest";
import {
  catalogRows,
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

const row = (id: string, key: string | null, weight: number, title = id) => ({
  game: game(id, key, title),
  subtitle: null,
  weight,
  inMyGames: false,
});

describe("groupCatalogRows", () => {
  it("sorts rows by weight inside a type, and types by their most-played game", () => {
    const sections = groupCatalogRows([
      row("wordle", "wordle", 1),
      row("connections", "connections", 2),
      row("globle", "globle", 5),
      row("mystery", null, 3),
    ]);
    expect(sections.map((s) => [s.title, s.data.map((r) => r.game.id)])).toEqual([
      ["Geography", ["globle"]],
      ["Other", ["mystery"]],
      ["Word games", ["connections", "wordle"]],
    ]);
  });

  it("breaks weight ties by registry category order, then title", () => {
    const sections = groupCatalogRows([
      row("b", null, 0, "Beta"),
      row("a", null, 0, "Alpha"),
      row("wordle", "wordle", 0),
      row("globle", "globle", 0),
    ]);
    expect(sections.map((s) => s.category)).toEqual(["words", "geography", "other"]);
    expect(sections[2]?.data.map((r) => r.game.title)).toEqual(["Alpha", "Beta"]);
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

  it("friends rows say how many and which friends; catalog rows say only how many", () => {
    const dg: DiscoveryGame = {
      game: game("d", "wordle"),
      friends: [
        { userId: "u1", displayName: "Sam" },
        { userId: "u2", displayName: "Alex" },
        { userId: "u3", displayName: "Q" },
      ],
      inMyGames: true,
    };
    expect(friendsFeedRows([dg])[0]).toMatchObject({
      subtitle: "3 friends · Sam, Alex +1",
      weight: 3,
      inMyGames: true,
    });
    const cg: CatalogGame = { game: game("c", null), playerCount: 3, inMyGames: false };
    expect(catalogRows([cg])[0]).toMatchObject({ subtitle: "3 players", weight: 3 });
  });
});
