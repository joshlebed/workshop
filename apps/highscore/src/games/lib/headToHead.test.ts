import type { HeadToHeadDay, HeadToHeadGame, HeadToHeadOutcome } from "@workshop/shared/friends";
import { describe, expect, it } from "vitest";
import {
  currentStreak,
  emptyLine,
  friendsSinceLabel,
  gamesLine,
  leadSeries,
  mutualFriendsLabel,
  recentForm,
  sharedDaysLine,
  shortDate,
  streakLabel,
  totals,
  winPercent,
  winRateLine,
} from "./headToHead";

function day(periodKey: string, outcome: HeadToHeadOutcome): HeadToHeadDay {
  return { periodKey, outcome, viewerScore: 1, friendScore: 1 };
}

function game(id: string, days: HeadToHeadDay[], plays = days.length): HeadToHeadGame {
  return {
    game: {
      id,
      url: `https://${id}.example`,
      normalizedUrl: `${id}.example`,
      title: id,
      iconUrl: null,
      gameKey: null,
      scoreDirection: "desc",
      scoreSpec: null,
      summarySpec: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    viewer: { plays, averageScore: null },
    friend: { plays: plays + 1, averageScore: null },
    sharedDays: days.length,
    wins: days.filter((d) => d.outcome === "win").length,
    losses: days.filter((d) => d.outcome === "loss").length,
    ties: days.filter((d) => d.outcome === "tie").length,
    days,
  };
}

describe("totals", () => {
  it("sums records and counts games led, trailed and level", () => {
    const t = totals([
      game("a", [day("2026-06-01", "win"), day("2026-06-02", "win"), day("2026-06-03", "loss")]),
      game("b", [day("2026-06-01", "loss")]),
      game("c", [day("2026-06-01", "tie")]),
      game("d", [day("2026-06-01", "none")]),
    ]);
    expect(t).toMatchObject({ wins: 2, losses: 2, ties: 1, sharedDays: 6 });
    expect(t).toMatchObject({ gamesLed: 1, gamesTrailed: 1, gamesLevel: 1 });
    expect(t.viewerPlays).toBe(6);
    expect(t.friendPlays).toBe(10);
  });
});

describe("copy", () => {
  it("is a percent of decided days", () => {
    expect(winPercent({ wins: 2, losses: 1, ties: 1 })).toBe(50);
    expect(winPercent({ wins: 0, losses: 0, ties: 0 })).toBeNull();
    expect(winRateLine({ wins: 2, losses: 1, ties: 1 })).toBe("You win 50% of the time");
    expect(winRateLine({ wins: 0, losses: 0, ties: 0 })).toBeNull();
  });

  it("says what the score is a score of, with ties only when there are any", () => {
    expect(sharedDaysLine(33, 6)).toBe("33 days you both played · 6 ties");
    expect(sharedDaysLine(1, 1)).toBe("1 day you both played · 1 tie");
    expect(sharedDaysLine(4, 0)).toBe("4 days you both played");
  });

  it("says who is ahead in how many games", () => {
    const t = (gamesLed: number, gamesTrailed: number, gamesLevel: number) => ({
      ...totals([]),
      gamesLed,
      gamesTrailed,
      gamesLevel,
    });
    expect(gamesLine(t(4, 1, 0), "Alex")).toBe("You're ahead in 4 games, Alex in 1.");
    expect(gamesLine(t(1, 2, 2), "Alex")).toBe("You're ahead in 1 game, Alex in 2. 2 are even.");
    expect(gamesLine(t(5, 0, 0), "Alex")).toBe("You're ahead in all 5 games.");
    expect(gamesLine(t(2, 0, 1), "Alex")).toBe("You're ahead in 2 games. 1 is even.");
    expect(gamesLine(t(0, 3, 0), "Alex")).toBe("Alex is ahead in all 3 games.");
    expect(gamesLine(t(0, 0, 2), "Alex")).toBe("Dead even in every game.");
    expect(gamesLine(t(1, 0, 0), "Alex")).toBeNull();
  });

  it("words the empty state for the range", () => {
    expect(emptyLine("7", "Alex")).toBe("You and Alex haven't played the same game this week.");
    expect(emptyLine("30", "Alex")).toBe("You and Alex haven't played the same game this month.");
    expect(emptyLine("all", "Alex")).toBe("You and Alex haven't played any of the same games yet.");
  });

  it("dates a friendship and names a few mutual friends", () => {
    const now = new Date("2026-11-18T12:00:00");
    expect(friendsSinceLabel("2026-11-04T12:00:00", now)).toBe("Friends since Nov 4");
    expect(friendsSinceLabel("2025-03-09T12:00:00", now)).toBe("Friends since Mar 9, 2025");
    expect(friendsSinceLabel("nope", now)).toBe("Friends");
    expect(mutualFriendsLabel([])).toBeNull();
    expect(mutualFriendsLabel(["Sam"])).toBe("Mutual friend: Sam");
    expect(mutualFriendsLabel(["Sam", "Riley"])).toBe("Mutual friends: Sam, Riley");
    expect(mutualFriendsLabel(["a", "b", "c", "d"])).toBe("4 mutual friends");
  });
});

describe("streaks and form", () => {
  const days = [
    day("2026-06-01", "loss"),
    day("2026-06-02", "win"),
    day("2026-06-03", "none"),
    day("2026-06-04", "win"),
  ];

  it("skips undecided days instead of breaking the run", () => {
    expect(currentStreak(days)).toEqual({ outcome: "win", length: 2 });
    expect(currentStreak([day("2026-06-01", "none")])).toBeNull();
  });

  it("only speaks up for a run of two or more", () => {
    expect(streakLabel(days, "Alex")).toBe("You've won the last 2");
    expect(streakLabel([day("2026-06-01", "loss")], "Alex")).toBeNull();
    expect(streakLabel([day("2026-06-01", "loss"), day("2026-06-02", "loss")], "Alex")).toBe(
      "Alex won the last 2",
    );
    expect(streakLabel([day("2026-06-01", "tie"), day("2026-06-02", "tie")], "Alex")).toBe(
      "2 ties in a row",
    );
  });

  it("keeps the newest days, oldest first", () => {
    expect(recentForm(days, 2).map((d) => d.periodKey)).toEqual(["2026-06-03", "2026-06-04"]);
    expect(recentForm(days, 10)).toHaveLength(4);
  });
});

describe("leadSeries", () => {
  const games = [
    game("a", [day("2026-06-01", "win"), day("2026-06-02", "loss"), day("2026-06-03", "win")]),
    game("b", [day("2026-06-01", "win"), day("2026-06-03", "tie"), day("2026-06-04", "loss")]),
  ];

  it("accumulates wins minus losses by day across games", () => {
    expect(leadSeries(games, 40)).toEqual([
      { periodKey: "2026-06-01", lead: 2 },
      { periodKey: "2026-06-02", lead: 1 },
      { periodKey: "2026-06-03", lead: 2 },
      { periodKey: "2026-06-04", lead: 1 },
    ]);
  });

  it("thins to the cap and still ends on the last day", () => {
    const thinned = leadSeries(games, 2);
    expect(thinned).toEqual([
      { periodKey: "2026-06-02", lead: 1 },
      { periodKey: "2026-06-04", lead: 1 },
    ]);
  });
});

describe("shortDate", () => {
  it("formats a period key without shifting the day", () => {
    expect(shortDate("2026-06-30")).toBe("Jun 30");
    expect(shortDate("nope")).toBe("nope");
  });
});
