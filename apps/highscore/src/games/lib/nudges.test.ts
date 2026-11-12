import type { GameNudgeState } from "@workshop/shared/games";
import { describe, expect, it } from "vitest";
import { nudgeAllowanceLabel, nudgeRefusalMessage, nudgeRowStatus, withNudgeSent } from "./nudges";

const state = (over: Partial<GameNudgeState> = {}): GameNudgeState => ({
  limit: 5,
  remaining: 5,
  nudgedUserIds: [],
  ...over,
});

describe("nudgeRowStatus", () => {
  it("hides the control without state", () => {
    expect(nudgeRowStatus(undefined, "a")).toBe("hidden");
  });

  it("is available for any friend, then sent, and spent once the allowance is gone", () => {
    expect(nudgeRowStatus(state(), "a")).toBe("available");
    expect(nudgeRowStatus(state({ nudgedUserIds: ["a"] }), "a")).toBe("sent");
    expect(nudgeRowStatus(state({ remaining: 0 }), "b")).toBe("spent");
    // A sent one still reads as sent when nothing is left.
    expect(nudgeRowStatus(state({ remaining: 0, nudgedUserIds: ["a"] }), "a")).toBe("sent");
  });

  it("never runs out for an unlimited sender", () => {
    expect(nudgeRowStatus(state({ limit: null, remaining: null }), "a")).toBe("available");
  });
});

describe("nudgeAllowanceLabel", () => {
  it("says what the bolt does and what is left", () => {
    expect(nudgeAllowanceLabel(state({ remaining: 4 }), 3)).toBe(
      "Ping a friend to come see the board · 4 left today",
    );
    expect(nudgeAllowanceLabel(state({ remaining: 0 }), 3)).toBe("No pings left today");
    expect(nudgeAllowanceLabel(state({ limit: null, remaining: null }), 3)).toBe(
      "Ping a friend to come see the board",
    );
  });

  it("is silent when there is nobody to ping", () => {
    expect(nudgeAllowanceLabel(null, 3)).toBeNull();
    expect(nudgeAllowanceLabel(state(), 0)).toBeNull();
  });
});

describe("nudgeRefusalMessage", () => {
  it("names the friend whose notifications are off, else keeps the server's words", () => {
    expect(nudgeRefusalMessage("unreachable", "Renata", "x")).toBe(
      "Renata hasn't enabled HighScore notifications",
    );
    expect(nudgeRefusalMessage("daily_limit", "Renata", "You're out of pings for today.")).toBe(
      "You're out of pings for today.",
    );
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
