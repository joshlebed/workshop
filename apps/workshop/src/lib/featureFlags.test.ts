import { WORKSHOP_GAMES_SUNSET_AT } from "@workshop/shared/constants";
import { describe, expect, it } from "vitest";
import { isLegacyGamesActive, resolveLegacyGamesSunsetAt } from "./featureFlags";

const SUNSET = Date.parse(WORKSHOP_GAMES_SUNSET_AT);

describe("resolveLegacyGamesSunsetAt", () => {
  it("defaults to the shared cutover instant", () => {
    expect(resolveLegacyGamesSunsetAt(undefined)).toBe(SUNSET);
    expect(resolveLegacyGamesSunsetAt("")).toBe(SUNSET);
    expect(resolveLegacyGamesSunsetAt("garbage")).toBe(SUNSET);
  });

  it("supports the never / now / ISO overrides", () => {
    expect(resolveLegacyGamesSunsetAt("never")).toBeNull();
    expect(resolveLegacyGamesSunsetAt("now")).toBe(0);
    expect(resolveLegacyGamesSunsetAt("2027-01-01T00:00:00Z")).toBe(
      Date.parse("2027-01-01T00:00:00Z"),
    );
  });
});

describe("isLegacyGamesActive", () => {
  it("is on before the sunset and off from the sunset instant", () => {
    expect(isLegacyGamesActive(SUNSET - 1)).toBe(true);
    expect(isLegacyGamesActive(SUNSET)).toBe(false);
    expect(isLegacyGamesActive(SUNSET + 86_400_000)).toBe(false);
  });
});
