import { USER_FLAG_KEYS } from "@workshop/shared/constants";
import { describe, expect, it } from "vitest";
import {
  completedFlagValue,
  dismissedFlagValue,
  isSharePractice,
  onboardedFlagValue,
  runtimeHasShareSetup,
  SHARE_PRACTICE_TEXT,
  SHARE_WALKTHROUGH_STEPS,
  shouldAutoOpenShareSetup,
  shouldShowShareAnnouncement,
} from "./shareOnboarding";

describe("shouldShowShareAnnouncement", () => {
  it("shows on a supported binary with loaded, empty flags", () => {
    expect(shouldShowShareAnnouncement({ flags: {}, supported: true })).toBe(true);
  });

  it("never shows on an unsupported binary", () => {
    expect(shouldShowShareAnnouncement({ flags: {}, supported: false })).toBe(false);
  });

  it("never shows while flags are still loading (no flash for already-dismissed users)", () => {
    expect(shouldShowShareAnnouncement({ flags: undefined, supported: true })).toBe(false);
  });

  it("stays hidden once dismissed or completed", () => {
    for (const value of [
      dismissedFlagValue(new Date("2026-08-31T00:00:00Z")),
      completedFlagValue(new Date("2026-08-31T00:00:00Z")),
    ]) {
      expect(
        shouldShowShareAnnouncement({
          flags: { [USER_FLAG_KEYS.shareSheetAnnouncement]: value },
          supported: true,
        }),
      ).toBe(false);
    }
  });

  it("stays hidden for a user who already posted via the share sheet", () => {
    expect(
      shouldShowShareAnnouncement({
        flags: { [USER_FLAG_KEYS.shareExtensionScore]: { firstAt: "2026-08-30T00:00:00Z" } },
        supported: true,
      }),
    ).toBe(false);
  });

  it("keeps showing after the walkthrough merely auto-opened and was skipped", () => {
    const value = onboardedFlagValue(undefined, new Date("2026-11-09T00:00:00Z"));
    expect(
      shouldShowShareAnnouncement({
        flags: { [USER_FLAG_KEYS.shareSheetAnnouncement]: value },
        supported: true,
      }),
    ).toBe(true);
  });
});

describe("shouldAutoOpenShareSetup", () => {
  const at = new Date("2026-11-09T00:00:00Z");

  it("opens once for a supported binary with loaded, empty flags", () => {
    expect(shouldAutoOpenShareSetup({ flags: {}, supported: true })).toBe(true);
  });

  it("never opens unsupported or while flags load", () => {
    expect(shouldAutoOpenShareSetup({ flags: {}, supported: false })).toBe(false);
    expect(shouldAutoOpenShareSetup({ flags: undefined, supported: true })).toBe(false);
  });

  it("never opens again once auto-opened, dismissed, or completed", () => {
    for (const value of [
      onboardedFlagValue(undefined, at),
      dismissedFlagValue(at),
      completedFlagValue(at),
    ]) {
      expect(
        shouldAutoOpenShareSetup({
          flags: { [USER_FLAG_KEYS.shareSheetAnnouncement]: value },
          supported: true,
        }),
      ).toBe(false);
    }
  });

  it("never opens for a user already posting through the share sheet", () => {
    expect(
      shouldAutoOpenShareSetup({
        flags: { [USER_FLAG_KEYS.shareExtensionScore]: { firstAt: "2026-08-30T00:00:00Z" } },
        supported: true,
      }),
    ).toBe(false);
  });
});

describe("runtimeHasShareSetup", () => {
  it("is on for iOS 1.2.0 and later", () => {
    expect(runtimeHasShareSetup("ios", "1.2.0")).toBe(true);
    expect(runtimeHasShareSetup("ios", "1.10.0")).toBe(true);
    expect(runtimeHasShareSetup("ios", "2.0.0")).toBe(true);
  });

  it("holds back the 1.0.1 and 1.1.0 Store binaries, which still get every OTA", () => {
    expect(runtimeHasShareSetup("ios", "1.0.1")).toBe(false);
    expect(runtimeHasShareSetup("ios", "1.1.0")).toBe(false);
  });

  it("is off on web, Android, and an unknown version", () => {
    expect(runtimeHasShareSetup("web", "1.2.0")).toBe(false);
    expect(runtimeHasShareSetup("android", "1.2.0")).toBe(false);
    expect(runtimeHasShareSetup("ios", null)).toBe(false);
    expect(runtimeHasShareSetup("ios", "not-a-version")).toBe(false);
  });
});

describe("flag values", () => {
  it("stamp the given time as ISO strings", () => {
    const at = new Date("2026-08-31T12:34:56.000Z");
    expect(dismissedFlagValue(at)).toEqual({ dismissedAt: "2026-08-31T12:34:56.000Z" });
    expect(completedFlagValue(at)).toEqual({ completedAt: "2026-08-31T12:34:56.000Z" });
  });

  it("onboardedFlagValue keeps whatever was already on the flag", () => {
    const at = new Date("2026-11-09T00:00:00.000Z");
    expect(onboardedFlagValue(undefined, at)).toEqual({ onboardedAt: "2026-11-09T00:00:00.000Z" });
    expect(onboardedFlagValue({ dismissedAt: "2026-08-31T00:00:00.000Z" }, at)).toEqual({
      dismissedAt: "2026-08-31T00:00:00.000Z",
      onboardedAt: "2026-11-09T00:00:00.000Z",
    });
    expect(onboardedFlagValue("garbage", at)).toEqual({ onboardedAt: "2026-11-09T00:00:00.000Z" });
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
