import type { GameScore, GamesResponse, MyGame } from "@workshop/shared/games";
import { describe, expect, it } from "vitest";
import { applyPostedScore } from "./postedScore";

const viewer = { id: "me", displayName: "Josh" };
const score = (over: Partial<GameScore> = {}): GameScore => ({
  gameId: "g1",
  userId: "me",
  periodKey: "2026-10-25",
  scoreValue: 944,
  scoreRaw: "GeoSports 944 / 1,000",
  parseStatus: "score",
  scoreSummary: "944 / 1,000",
  createdAt: "2026-10-25T10:00:00Z",
  updatedAt: "2026-10-25T10:00:00Z",
  ...over,
});
const myGame = (gameId: string, entries: MyGame["standings"]["entries"]): MyGame => ({
  gameId,
  position: 0,
  addedAt: "2026-10-01T00:00:00Z",
  game: {
    id: gameId,
    title: gameId,
    url: `https://${gameId}.example`,
    iconUrl: null,
    scoreDirection: "desc",
  } as MyGame["game"],
  standings: { periodKey: "2026-10-25", entries, viewerHasPlayed: false, viewerStreak: 0 },
});
const friend = {
  userId: "alex",
  displayName: "Alex",
  scoreRaw: "GeoSports 800 / 1,000",
  scoreValue: 800,
  rank: 1,
  updatedAt: "2026-10-25T09:00:00Z",
  reactions: [],
};
const list = (games: MyGame[]): GamesResponse => ({
  periodKey: "2026-10-25",
  games,
  capabilities: { recognition: true, codeParsing: true, teach: true },
});

describe("applyPostedScore", () => {
  it("adds the viewer's row to the game on a first post of the day", () => {
    const data = list([myGame("g1", [friend]), myGame("g2", [])]);
    const out = applyPostedScore(data, score(), viewer);
    const g1 = out?.games[0]?.standings;
    expect(g1?.viewerHasPlayed).toBe(true);
    expect(g1?.entries.map((e) => e.userId)).toEqual(["alex", "me"]);
    expect(g1?.entries[1]).toMatchObject({
      displayName: "Josh",
      scoreValue: 944,
      scoreRaw: "GeoSports 944 / 1,000",
      parseStatus: "score",
      scoreSummary: "944 / 1,000",
      rank: null,
      reactions: [],
    });
    expect(out?.games[1]).toBe(data.games[1]);
  });

  it("replaces the viewer's existing row in place, keeping its rank and reactions", () => {
    const mine = {
      ...friend,
      userId: "me",
      displayName: "Josh",
      rank: 2,
      reactions: [
        {
          emoji: "🔥",
          count: 1,
          reactors: [{ userId: "alex", displayName: "Alex" }],
          viewerReacted: false,
        },
      ],
    };
    const out = applyPostedScore(
      list([myGame("g1", [friend, mine])]),
      score({ scoreValue: 999 }),
      viewer,
    );
    const entries = out?.games[0]?.standings.entries ?? [];
    expect(entries.map((e) => e.userId)).toEqual(["alex", "me"]);
    expect(entries[1]).toMatchObject({ scoreValue: 999, rank: 2 });
    expect(entries[1]?.reactions).toHaveLength(1);
  });

  it("leaves the list alone when the game is not in it, or the day differs, or there is no list", () => {
    const data = list([myGame("g2", [])]);
    expect(applyPostedScore(data, score(), viewer)).toBe(data);
    expect(applyPostedScore(data, score({ gameId: "g2", periodKey: "2026-10-24" }), viewer)).toBe(
      data,
    );
    expect(applyPostedScore(undefined, score(), viewer)).toBeUndefined();
  });

  it("does not carry a legacy score's absent code fields as explicit undefineds", () => {
    const legacy = score();
    delete legacy.parseStatus;
    delete legacy.scoreSummary;
    const out = applyPostedScore(list([myGame("g1", [])]), legacy, viewer);
    const entry = out?.games[0]?.standings.entries[0];
    expect(entry && "parseStatus" in entry).toBe(false);
  });
});
