import { describe, expect, it } from "vitest";
import { buildActivationCohorts, type CohortMember, utcWeekStart } from "./adminActivation.js";

const H = 3_600_000;
const now = new Date("2026-11-25T12:00:00Z"); // a Wednesday

function member(id: string, createdAt: string, signupSource: string | null = "none"): CohortMember {
  return { userId: id, createdAt: new Date(createdAt), signupSource };
}

function at(createdAt: string, hours: number): Date {
  return new Date(new Date(createdAt).getTime() + hours * H);
}

describe("utcWeekStart", () => {
  it("is the Monday of the UTC week", () => {
    expect(utcWeekStart(new Date("2026-11-25T12:00:00Z"))).toBe("2026-11-23");
    expect(utcWeekStart(new Date("2026-11-23T00:00:00Z"))).toBe("2026-11-23");
    expect(utcWeekStart(new Date("2026-11-22T23:59:59Z"))).toBe("2026-11-16");
  });
});

describe("buildActivationCohorts", () => {
  const t = "2026-11-10T10:00:00Z"; // week of Nov 9
  const members = [
    member("a", t, "friend_invite"),
    member("b", t, "play_link"),
    member("c", t, null),
    member("d", "2026-11-25T02:00:00Z"), // 10h old: not eligible for day 1
  ];
  const milestones = new Map([
    [
      "a",
      new Map([
        ["first_score", at(t, 1)],
        ["second_friend", at(t, 2)],
        ["third_game", at(t, 23.9)],
      ]),
    ],
    [
      "b",
      new Map([
        ["first_score", at(t, 1)],
        ["second_friend", at(t, 2)],
        ["third_game", at(t, 24)], // exactly 24h: not day 1
      ]),
    ],
    ["d", new Map([["first_score", at("2026-11-25T02:00:00Z", 1)]])],
  ]);
  const lastAction = new Map([
    ["a", "2026-11-17"], // signup day + 7: counts
    ["b", "2026-11-16"], // + 6: doesn't
  ]);
  const out = buildActivationCohorts(members, milestones, lastAction, now, 4);

  it("has one row per week, newest first, including empty weeks", () => {
    expect(out.weeks.map((w) => w.key)).toEqual([
      "2026-11-23",
      "2026-11-16",
      "2026-11-09",
      "2026-11-02",
    ]);
    expect(out.weeks[1]?.signups).toBe(0);
  });

  it("counts day-1 milestones strictly within 24h and 2-3-1 only when all three are", () => {
    const week = out.weeks[2];
    expect(week?.signups).toBe(3);
    expect(week?.firstScore).toEqual({ reached: 2, eligible: 3 });
    expect(week?.twoFriends).toEqual({ reached: 2, eligible: 3 });
    expect(week?.threeGames).toEqual({ reached: 1, eligible: 3 });
    expect(week?.all).toEqual({ reached: 1, eligible: 3 });
    expect(week?.backAfterDay7).toEqual({ reached: 1, eligible: 3 });
  });

  it("leaves members inside their window out of the denominator", () => {
    const current = out.weeks[0];
    expect(current?.signups).toBe(1);
    expect(current?.firstScore).toEqual({ reached: 0, eligible: 0 });
    expect(current?.backAfterDay7).toEqual({ reached: 0, eligible: 0 });
  });

  it("splits the same members by signup source, dropping empty sources", () => {
    expect(out.bySource.map((s) => [s.key, s.signups])).toEqual([
      ["friend_invite", 1],
      ["play_link", 1],
      ["none", 1],
      ["unrecorded", 1],
    ]);
    expect(out.bySource[0]?.all).toEqual({ reached: 1, eligible: 1 });
  });
});
