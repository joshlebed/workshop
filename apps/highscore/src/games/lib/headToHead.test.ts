import type { HeadToHeadDay, HeadToHeadGame, HeadToHeadOutcome } from "@workshop/shared/friends";
import { describe, expect, it } from "vitest";
import {
  currentStreak,
  leadSeries,
  recentForm,
  recordLabel,
  shortDate,
  streakLabel,
  totals,
  verdict,
  winPercent,
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

describe("record copy", () => {
  it("is a percent of decided days", () => {
    expect(winPercent({ wins: 2, losses: 1, ties: 1 })).toBe(50);
    expect(winPercent({ wins: 0, losses: 0, ties: 0 })).toBeNull();
  });

  it("shows ties only when there are any", () => {
    expect(recordLabel({ wins: 3, losses: 1, ties: 0 })).toBe("3–1");
    expect(recordLabel({ wins: 3, losses: 1, ties: 2 })).toBe("3–1–2");
  });

  it("names who leads", () => {
    expect(verdict({ wins: 3, losses: 1, ties: 0 }, "Alex")).toBe("You lead 3–1");
    expect(verdict({ wins: 1, losses: 3, ties: 0 }, "Alex")).toBe("Alex leads 3–1");
    expect(verdict({ wins: 2, losses: 2, ties: 5 }, "Alex")).toBe("All square at 2–2");
    expect(verdict({ wins: 0, losses: 0, ties: 0 }, "Alex")).toBe("No days decided yet");
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
      "Alex has won the last 2",
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
