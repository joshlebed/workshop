import { WORKSHOP_GAMES_REMOVED_AT, WORKSHOP_GAMES_SUNSET_AT } from "@workshop/shared/constants";
import { describe, expect, it } from "vitest";
import {
  isLegacyGamesActive,
  legacyGamesPhaseAt,
  nextLegacyGamesPhaseChange,
  parseLegacyGamesPhaseOverride,
} from "./featureFlags";

const SUNSET = Date.parse(WORKSHOP_GAMES_SUNSET_AT);
const REMOVED = Date.parse(WORKSHOP_GAMES_REMOVED_AT);

describe("legacyGamesPhaseAt", () => {
  it("walks active → moved → gone on the shared dates", () => {
    expect(legacyGamesPhaseAt(SUNSET - 1, null)).toBe("active");
    expect(legacyGamesPhaseAt(SUNSET, null)).toBe("moved");
    expect(legacyGamesPhaseAt(REMOVED - 1, null)).toBe("moved");
    expect(legacyGamesPhaseAt(REMOVED, null)).toBe("gone");
  });

  it("removal is two weeks after the sunset", () => {
    expect(REMOVED - SUNSET).toBe(14 * 86_400_000);
  });

  it("honours a forced phase", () => {
    expect(legacyGamesPhaseAt(SUNSET - 1, "gone")).toBe("gone");
    expect(legacyGamesPhaseAt(REMOVED + 1, "active")).toBe("active");
  });
});

describe("parseLegacyGamesPhaseOverride", () => {
  it("accepts only the three phases", () => {
    expect(parseLegacyGamesPhaseOverride(" moved ")).toBe("moved");
    expect(parseLegacyGamesPhaseOverride("gone")).toBe("gone");
    expect(parseLegacyGamesPhaseOverride("never")).toBeNull();
    expect(parseLegacyGamesPhaseOverride(undefined)).toBeNull();
  });
});

describe("nextLegacyGamesPhaseChange", () => {
  it("returns the next boundary and null after the last one", () => {
    expect(nextLegacyGamesPhaseChange(SUNSET - 1)).toBe(SUNSET);
    expect(nextLegacyGamesPhaseChange(SUNSET)).toBe(REMOVED);
    expect(nextLegacyGamesPhaseChange(REMOVED)).toBeNull();
  });
});

describe("isLegacyGamesActive", () => {
  it("is on only before the sunset", () => {
    expect(isLegacyGamesActive(SUNSET - 1)).toBe(true);
    expect(isLegacyGamesActive(SUNSET)).toBe(false);
  });
});
