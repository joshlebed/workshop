import type { GameNudgeState } from "@workshop/shared/games";
import { describe, expect, it } from "vitest";
import {
  nudgeAllowanceLabel,
  nudgeRefusalMessage,
  nudgeRowStatus,
  pokeBlockedMessage,
  withNudgeSent,
} from "./nudges";

const state = (over: Partial<GameNudgeState> = {}): GameNudgeState => ({
  limit: 5,
  remaining: 5,
  nudgedUserIds: [],
  reachableUserIds: ["a", "b"],
  canSend: true,
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
    // A sent one still reads as sent when nothing is left.
    expect(nudgeRowStatus(state({ remaining: 0, nudgedUserIds: ["a"] }), "a")).toBe("sent");
  });

  it("stays available when the viewer has no device: the tap asks for notifications", () => {
    expect(nudgeRowStatus(state({ canSend: false }), "a")).toBe("available");
  });

  it("never runs out for an unlimited sender", () => {
    expect(nudgeRowStatus(state({ limit: null, remaining: null }), "a")).toBe("available");
  });
});

describe("nudgeAllowanceLabel", () => {
  it("says what the hand does and what is left", () => {
    expect(nudgeAllowanceLabel(state({ remaining: 4 }))).toBe("Poke a friend · 4 left today");
    expect(nudgeAllowanceLabel(state({ remaining: 0 }))).toBe("No pokes left today");
    expect(nudgeAllowanceLabel(state({ limit: null, remaining: null }))).toBe(
      "Poke a friend · ∞ left today",
    );
  });

  it("is silent when there is nobody to poke", () => {
    expect(nudgeAllowanceLabel(null)).toBeNull();
    expect(nudgeAllowanceLabel(state({ reachableUserIds: [] }))).toBeNull();
  });
});

describe("messages", () => {
  it("tells a sender without notifications how to get them", () => {
    expect(pokeBlockedMessage("dismissed")).toBe("Turn on notifications to poke friends");
    expect(pokeBlockedMessage("denied")).toBe(
      "Turn on notifications for HighScore in Settings to poke friends",
    );
    expect(pokeBlockedMessage("unsupported")).toBe(
      "Poking needs notifications on in the HighScore iPhone app",
    );
  });

  it("maps the server's refusals, else keeps the fallback", () => {
    expect(nudgeRefusalMessage("unreachable", "Renata", "x")).toBe(
      "Renata hasn't enabled HighScore notifications",
    );
    expect(nudgeRefusalMessage("sender_unreachable", "Renata", "x")).toBe(
      "Turn on notifications to poke friends",
    );
    expect(nudgeRefusalMessage("push_failed", "Renata", "Failed to send poke")).toBe(
      "Failed to send poke",
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
