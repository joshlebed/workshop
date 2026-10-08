import type { FriendProfileGame, FriendProfileResponse } from "@workshop/shared/friends";
import type { GameStandingsEntry, GamesResponse } from "@workshop/shared/games";
import { describe, expect, it } from "vitest";
import { buildProfileWeek } from "./profileWeek";

const DAYS = [
  "2026-10-02",
  "2026-10-03",
  "2026-10-04",
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
  "2026-10-08",
];

const game: FriendProfileGame["game"] = {
  id: "g1",
  url: "https://g1.test",
  normalizedUrl: "g1.test",
  title: "G1",
  iconUrl: null,
  gameKey: null,
  scoreDirection: "asc",
  scoreSpec: null,
  summarySpec: null,
  createdAt: "",
};

function profile(date: string, played: boolean): FriendProfileResponse {
  return {
    user: { userId: "them", displayName: "Them" },
    relationship: "friends",
    friendsSince: null,
    mutualFriends: [],
    periodKey: date,
    games: [{ game, viewerHasGame: true, score: played ? { scoreRaw: "x", scoreValue: 1 } : null }],
  };
}

function entry(userId: string, rank: number): GameStandingsEntry {
  return {
    userId,
    displayName: userId,
    scoreRaw: "x",
    scoreValue: rank,
    rank,
    updatedAt: null,
    reactions: [],
  };
}

function games(date: string, entries: GameStandingsEntry[]): GamesResponse {
  return {
    periodKey: date,
    games: [
      {
        gameId: "g1",
        position: null,
        addedAt: "",
        game,
        standings: {
          periodKey: date,
          entries,
          viewerHasPlayed: entries.some((e) => e.userId === "me"),
          viewerStreak: 0,
        },
      },
    ],
  };
}

describe("buildProfileWeek", () => {
  it("marks played / won / none per day and tallies head-to-head", () => {
    const profileByDay = new Map(DAYS.map((d) => [d, profile(d, d >= "2026-10-05")]));
    const gamesByDay = new Map<string, GamesResponse>([
      ["2026-10-05", games("2026-10-05", [entry("them", 1), entry("me", 2)])],
      ["2026-10-06", games("2026-10-06", [entry("me", 1), entry("them", 2)])],
      ["2026-10-07", games("2026-10-07", [entry("them", 1)])],
      ["2026-10-08", games("2026-10-08", [entry("them", 1), entry("me", 1)])],
    ]);
    const week = buildProfileWeek({
      days: DAYS,
      subjectId: "them",
      viewerId: "me",
      profileByDay,
      gamesByDay,
      summarize: () => "x",
    });
    const row = week.rows[0];
    expect(row?.cells.map((c) => c.state)).toEqual([
      "none",
      "none",
      "none",
      "won",
      "played",
      "played",
      "played",
    ]);
    expect(row?.h2h).toEqual({ viewer: 1, subject: 1 });
    expect(week.summary).toEqual({ plays: 4, wins: 1, streak: 4, streakCapped: false });
  });

  it("flags a streak that runs off the window as capped", () => {
    const profileByDay = new Map(DAYS.map((d) => [d, profile(d, true)]));
    const week = buildProfileWeek({
      days: DAYS,
      subjectId: "them",
      viewerId: "me",
      profileByDay,
      gamesByDay: new Map(),
      summarize: () => null,
    });
    expect(week.summary.streak).toBe(7);
    expect(week.summary.streakCapped).toBe(true);
    expect(week.rows[0]?.cells[0]?.state).toBe("unknown");
  });
});
