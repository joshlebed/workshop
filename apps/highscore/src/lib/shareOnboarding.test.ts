import { USER_FLAG_KEYS } from "@workshop/shared/constants";
import { describe, expect, it } from "vitest";
import {
  completedFlagValue,
  dismissedFlagValue,
  SHARE_WALKTHROUGH_STEPS,
  shouldShowShareAnnouncement,
} from "./shareOnboarding";

describe("shouldShowShareAnnouncement", () => {
  it("shows for an iOS user with loaded, empty flags", () => {
    expect(shouldShowShareAnnouncement({ flags: {}, isIosNative: true })).toBe(true);
  });

  it("never shows off iOS native — there is no share sheet to set up", () => {
    expect(shouldShowShareAnnouncement({ flags: {}, isIosNative: false })).toBe(false);
  });

  it("never shows while flags are still loading (no flash for already-dismissed users)", () => {
    expect(shouldShowShareAnnouncement({ flags: undefined, isIosNative: true })).toBe(false);
  });

  it("stays hidden once dismissed or completed", () => {
    for (const value of [
      dismissedFlagValue(new Date("2026-08-31T00:00:00Z")),
      completedFlagValue(new Date("2026-08-31T00:00:00Z")),
    ]) {
      expect(
        shouldShowShareAnnouncement({
          flags: { [USER_FLAG_KEYS.shareSheetAnnouncement]: value },
          isIosNative: true,
        }),
      ).toBe(false);
    }
  });

  it("stays hidden for a user who already posted via the share sheet", () => {
    expect(
      shouldShowShareAnnouncement({
        flags: { [USER_FLAG_KEYS.shareExtensionScore]: { firstAt: "2026-08-30T00:00:00Z" } },
        isIosNative: true,
      }),
    ).toBe(false);
  });
});

describe("flag values", () => {
  it("stamp the given time as ISO strings", () => {
    const at = new Date("2026-08-31T12:34:56.000Z");
    expect(dismissedFlagValue(at)).toEqual({ dismissedAt: "2026-08-31T12:34:56.000Z" });
    expect(completedFlagValue(at)).toEqual({ completedAt: "2026-08-31T12:34:56.000Z" });
  });
});

describe("SHARE_WALKTHROUGH_STEPS", () => {
  it("is a multi-step guide ending on the payoff", () => {
    expect(SHARE_WALKTHROUGH_STEPS.length).toBeGreaterThanOrEqual(3);
    for (const step of SHARE_WALKTHROUGH_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
    }
  });
});
