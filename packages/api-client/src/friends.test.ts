// The friends responses are validated with zod before they reach the UI, and
// zod's `z.object` DROPS keys it does not list. So a field the server adds to
// a score has to be added to the schema too, or it silently never arrives.
// These fixtures pin the fields the client depends on.

import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn<(options: { method: string; path: string }) => Promise<unknown>>();
vi.mock("./api", () => ({
  apiRequest: (options: { method: string; path: string }) => apiRequest(options),
}));

import { fetchFriendProfile } from "./friends";

const game = (id: string, title: string) => ({
  id,
  url: `https://${id}.example`,
  normalizedUrl: `${id}.example`,
  title,
  iconUrl: null,
  gameKey: null,
  scoreDirection: "asc",
  scoreSpec: null,
  summarySpec: null,
  createdAt: "2026-10-01T00:00:00.000Z",
});

function profileResponse(games: unknown[]) {
  return {
    user: { userId: "friend-1", displayName: "Alex" },
    relationship: "friends",
    friendsSince: "2026-09-01T00:00:00.000Z",
    mutualFriends: [],
    periodKey: "2026-10-07",
    games,
  };
}

beforeEach(() => {
  apiRequest.mockReset();
});

describe("fetchFriendProfile", () => {
  it("passes through the server-computed fields on a score the server parsed", async () => {
    apiRequest.mockResolvedValue(
      profileResponse([
        {
          game: game("worldle", "Worldle"),
          viewerHasGame: true,
          score: {
            scoreRaw: "#Worldle #1663 (11.08.2026) 5/6 (100%)\n🟩🟩🟩🟩🟩🎉",
            scoreValue: 5,
            parseStatus: "score",
            scoreSummary: "🟩 5 5/6",
          },
        },
        {
          game: game("tradle", "Tradle"),
          viewerHasGame: false,
          score: {
            scoreRaw: "#Tradle #1557 X/6\n🟩🟩🟩⬜⬜",
            scoreValue: null,
            parseStatus: "no_result",
            scoreSummary: "🟩 3 X/6",
          },
        },
        {
          game: game("dailytens", "Daily Tens"),
          viewerHasGame: false,
          // A URL-only share: read by the server, with nothing worth showing.
          score: {
            scoreRaw: "https://dailytens.com/?ref=1",
            scoreValue: null,
            parseStatus: "failed",
            scoreSummary: null,
          },
        },
      ]),
    );

    const profile = await fetchFriendProfile("friend-1", "2026-10-07", "token");

    expect(profile.games?.map((g) => g.score)).toEqual([
      {
        scoreRaw: "#Worldle #1663 (11.08.2026) 5/6 (100%)\n🟩🟩🟩🟩🟩🎉",
        scoreValue: 5,
        parseStatus: "score",
        scoreSummary: "🟩 5 5/6",
      },
      {
        scoreRaw: "#Tradle #1557 X/6\n🟩🟩🟩⬜⬜",
        scoreValue: null,
        parseStatus: "no_result",
        scoreSummary: "🟩 3 X/6",
      },
      {
        scoreRaw: "https://dailytens.com/?ref=1",
        scoreValue: null,
        parseStatus: "failed",
        // null is an answer ("nothing to show"), and must survive as null.
        scoreSummary: null,
      },
    ]);
  });

  it("leaves a legacy score exactly as it was: no status, no summary", async () => {
    apiRequest.mockResolvedValue(
      profileResponse([
        {
          game: game("globle", "Globle"),
          viewerHasGame: true,
          score: { scoreRaw: "🟨🟩 = 2", scoreValue: 2 },
        },
        { game: game("wordle", "Wordle"), viewerHasGame: true, score: null },
      ]),
    );

    const profile = await fetchFriendProfile("friend-1", "2026-10-07", "token");

    const [globle, wordle] = profile.games ?? [];
    expect(globle?.score).toEqual({ scoreRaw: "🟨🟩 = 2", scoreValue: 2 });
    // Absent, not `undefined`-valued: the client's "did the server parse
    // this?" check is `parseStatus !== undefined`.
    expect(globle?.score && "parseStatus" in globle.score).toBe(false);
    expect(wordle?.score).toBe(null);
  });

  it("rejects a parse status the client does not know", async () => {
    apiRequest.mockResolvedValue(
      profileResponse([
        {
          game: game("worldle", "Worldle"),
          viewerHasGame: true,
          score: { scoreRaw: "x", scoreValue: null, parseStatus: "unread" },
        },
      ]),
    );
    await expect(fetchFriendProfile("friend-1", "2026-10-07", "token")).rejects.toThrow();
  });
});
