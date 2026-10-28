import { USER_FLAG_KEYS } from "@workshop/shared/constants";
import { describe, expect, it } from "vitest";
import {
  completedFlagValue,
  dismissedFlagValue,
  isSharePractice,
  SHARE_PRACTICE_TEXT,
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
  it("shows a ringed share-sheet screenshot for every step before the last", () => {
    const howSteps = SHARE_WALKTHROUGH_STEPS.slice(0, -1);
    expect(howSteps.length).toBeGreaterThanOrEqual(3);
    for (const step of howSteps) {
      expect(step.illustration).not.toBeNull();
      expect(step.highlight).not.toBeNull();
      expect(step.tryIt).toBe(false);
    }
  });

  it("keeps every ring inside its screenshot", () => {
    for (const { highlight } of SHARE_WALKTHROUGH_STEPS) {
      if (!highlight) continue;
      expect(highlight.x).toBeGreaterThanOrEqual(0);
      expect(highlight.y).toBeGreaterThanOrEqual(0);
      expect(highlight.x + highlight.width).toBeLessThanOrEqual(1);
      expect(highlight.y + highlight.height).toBeLessThanOrEqual(1);
    }
  });

  it("ends on the step that opens the real share sheet", () => {
    const last = SHARE_WALKTHROUGH_STEPS.at(-1);
    expect(last?.tryIt).toBe(true);
    expect(SHARE_WALKTHROUGH_STEPS.filter((s) => s.tryIt)).toHaveLength(1);
  });
});

describe("isSharePractice", () => {
  it("recognises the walkthrough's practice share, ignoring surrounding whitespace", () => {
    expect(isSharePractice(SHARE_PRACTICE_TEXT)).toBe(true);
    expect(isSharePractice(`  ${SHARE_PRACTICE_TEXT}\n`)).toBe(true);
  });

  it("never mistakes a real score share for it", () => {
    expect(isSharePractice("Wordle 1,572 4/6")).toBe(false);
    expect(isSharePractice(`${SHARE_PRACTICE_TEXT} Wordle 1,572 4/6`)).toBe(false);
    expect(isSharePractice(undefined)).toBe(false);
    expect(isSharePractice("")).toBe(false);
  });
});
