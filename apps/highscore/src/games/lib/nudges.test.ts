import type { GameNudgeState } from "@workshop/shared/games";
import { describe, expect, it } from "vitest";
import { nudgeAllowanceLabel, nudgeRowStatus, withNudgeSent } from "./nudges";

const state = (over: Partial<GameNudgeState> = {}): GameNudgeState => ({
  limit: 5,
  remaining: 5,
  nudgedUserIds: [],
  reachableUserIds: ["a", "b"],
  ...over,
});

describe("nudgeRowStatus", () => {
  it("hides the control without state or for a friend with no device", () => {
    expect(nudgeRowStatus(undefined, "a")).toBe("hidden");
    expect(nudgeRowStatus(state(), "c")).toBe("hidden");
  });

  it("is available, then sent, and spent once the allowance is gone", () => {
    expect(nudgeRowStatus(state(), "a")).toBe("available");
    expect(nudgeRowStatus(state({ nudgedUserIds: ["a"] }), "a")).toBe("sent");
    expect(nudgeRowStatus(state({ remaining: 0 }), "b")).toBe("spent");
    // A sent nudge still reads as sent when nothing is left.
    expect(nudgeRowStatus(state({ remaining: 0, nudgedUserIds: ["a"] }), "a")).toBe("sent");
  });

  it("never runs out for an unlimited sender", () => {
    expect(nudgeRowStatus(state({ limit: null, remaining: null }), "a")).toBe("available");
  });
});

describe("nudgeAllowanceLabel", () => {
  it("says what is left", () => {
    expect(nudgeAllowanceLabel(state({ remaining: 4 }))).toBe("4 of 5 nudges left today");
    expect(nudgeAllowanceLabel(state({ remaining: 0 }))).toBe("No nudges left today");
    expect(nudgeAllowanceLabel(state({ limit: null, remaining: null }))).toBe("Unlimited nudges");
  });

  it("is silent when there is nobody to nudge", () => {
    expect(nudgeAllowanceLabel(null)).toBeNull();
    expect(nudgeAllowanceLabel(state({ reachableUserIds: [] }))).toBeNull();
  });
});

describe("withNudgeSent", () => {
  it("marks the friend and takes the server's allowance", () => {
    const next = withNudgeSent(state(), "a", { limit: 5, remaining: 4 });
    expect(next.nudgedUserIds).toEqual(["a"]);
    expect(next.remaining).toBe(4);
    expect(withNudgeSent(next, "a", { limit: 5, remaining: 4 }).nudgedUserIds).toEqual(["a"]);
  });
});
