import { describe, expect, it } from "vitest";
import {
  DEFAULT_TYPICAL_SECONDS,
  estimatePlays,
  type PlayRow,
  sessionsForDay,
  summarizeDays,
  typicalSecondsByGame,
} from "./adminPlayTime.js";

const TZ = "America/New_York";

function row(at: string, gameId: string, extra: Partial<PlayRow> = {}): PlayRow {
  return {
    userId: "u1",
    gameId,
    gameTitle: gameId,
    createdAt: new Date(at),
    periodKey: "2026-11-23",
    scoreValue: 1,
    scoreUnit: null,
    summary: null,
    entrySource: "paste",
    ...extra,
  };
}

describe("estimatePlays", () => {
  it("counts the gap since the previous post inside a sitting", () => {
    // 18:24, 18:27, 18:31 Eastern on Nov 23 (UTC-5).
    const plays = estimatePlays(
      [
        row("2026-11-23T23:24:00Z", "tens"),
        row("2026-11-23T23:27:00Z", "maptap"),
        row("2026-11-23T23:31:00Z", "travle"),
      ],
      TZ,
      new Map([["tens", 150]]),
    );
    expect(plays.map((p) => [p.source, p.estimatedSeconds, p.session])).toEqual([
      ["typical", 150, 0],
      ["gap", 180, 0],
      ["gap", 240, 0],
    ]);
    expect(plays[0]?.localDay).toBe("2026-11-23");
    expect(plays[0]?.localMinute).toBeCloseTo(18 * 60 + 24);
  });

  it("starts a new sitting after a long gap and uses a short timer score", () => {
    const plays = estimatePlays(
      [
        row("2026-11-23T13:00:00Z", "tens"),
        row("2026-11-23T15:00:00Z", "queens", { scoreUnit: "seconds", scoreValue: 47 }),
        row("2026-11-23T20:00:00Z", "city", { scoreUnit: "seconds", scoreValue: 84_300 }),
      ],
      TZ,
      new Map(),
    );
    expect(plays.map((p) => [p.source, p.estimatedSeconds, p.session])).toEqual([
      ["typical", DEFAULT_TYPICAL_SECONDS, 0],
      ["timer", 47, 1],
      ["typical", DEFAULT_TYPICAL_SECONDS, 2],
    ]);
  });

  it("shows a late-pasted old day without counting it or breaking the sitting", () => {
    const plays = estimatePlays(
      [
        row("2026-11-23T23:24:00Z", "tens"),
        row("2026-11-23T23:25:00Z", "tens", { periodKey: "2026-11-10" }),
        row("2026-11-23T23:28:00Z", "maptap"),
      ],
      TZ,
      new Map(),
    );
    expect(plays.map((p) => [p.source, p.estimatedSeconds, p.session])).toEqual([
      ["typical", DEFAULT_TYPICAL_SECONDS, 0],
      ["backfill", 0, -1],
      ["gap", 240, 0],
    ]);
    expect(summarizeDays(plays)).toEqual([
      { day: "2026-11-23", seconds: DEFAULT_TYPICAL_SECONDS + 240, scores: 3, sessions: 1 },
    ]);
    const [session] = sessionsForDay(plays, "2026-11-23");
    expect(session?.scores).toBe(2);
    expect(session?.seconds).toBe(DEFAULT_TYPICAL_SECONDS + 240);
    expect(session?.startMinute).toBeCloseTo(18 * 60 + 24 - DEFAULT_TYPICAL_SECONDS / 60);
  });
});

describe("typicalSecondsByGame", () => {
  it("takes the median in-session gap once a game has three samples", () => {
    const byUser = new Map<string, PlayRow[]>();
    for (const [i, gap] of [60, 90, 300].entries()) {
      const start = Date.parse(`2026-11-2${i}T15:00:00Z`);
      const periodKey = `2026-11-2${i}`;
      byUser.set(`u${i}`, [
        row(new Date(start).toISOString(), "tens", { periodKey }),
        row(new Date(start + gap * 1000).toISOString(), "maptap", { periodKey }),
      ]);
    }
    const typical = typicalSecondsByGame(byUser, () => TZ);
    expect(typical.get("maptap")).toBe(90);
    expect(typical.has("tens")).toBe(false);
  });
});
