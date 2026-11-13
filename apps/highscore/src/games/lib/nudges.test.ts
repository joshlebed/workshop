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
  it("hides the control without state, and flags a friend with no device", () => {
    expect(nudgeRowStatus(undefined, "a")).toBe("hidden");
    expect(nudgeRowStatus(state(), "c")).toBe("unreachable");
    // Notifications off outranks an empty allowance: it's the more useful thing to say.
    expect(nudgeRowStatus(state({ remaining: 0 }), "c")).toBe("unreachable");
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
    expect(nudgeAllowanceLabel(state({ remaining: 4 }), 3)).toBe("Poke a friend · 4 left today");
    expect(nudgeAllowanceLabel(state({ remaining: 0 }), 3)).toBe("No pokes left today");
    expect(nudgeAllowanceLabel(state({ limit: null, remaining: null }), 3)).toBe(
      "Poke a friend · ∞ left today",
    );
  });

  it("is silent when there is nobody to poke", () => {
    expect(nudgeAllowanceLabel(null, 3)).toBeNull();
    expect(nudgeAllowanceLabel(state(), 0)).toBeNull();
    // Friends with notifications off still count: their hands show.
    expect(nudgeAllowanceLabel(state({ reachableUserIds: [] }), 2)).toBe(
      "Poke a friend · 5 left today",
    );
  });
});

describe("messages", () => {
  it("tells a sender without notifications how to get them", () => {
    expect(pokeBlockedMessage("dismissed")).toBe("Turn on notifications to poke friends");
    expect(pokeBlockedMessage("denied")).toBe(
      "Turn on notifications for HighScore in Settings to poke friends",
    );
    expect(pokeBlockedMessage("unsupported")).toBe(
      "Download the HighScore iPhone app and enable notifications to send pokes",
    );
  });

  it("maps the server's refusals, else keeps the fallback", () => {
    expect(nudgeRefusalMessage("unreachable", "Renata", "x")).toBe(
      "Renata doesn't have push notifications. They need to enable notifications to receive pokes.",
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
