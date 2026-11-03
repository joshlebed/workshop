import { describe, expect, it } from "vitest";
import {
  compareReleaseVersions,
  dismissedFlagValue,
  fakeInstalledVersionFromSearch,
  isBannerDismissed,
  parseReleaseVersion,
  releaseNudgeFor,
} from "./appRelease";

const NONE = { latestVersion: null, minimumVersion: null, storeUrl: null, message: null };

describe("parseReleaseVersion / compareReleaseVersions", () => {
  it("parses major.minor.patch only", () => {
    expect(parseReleaseVersion("1.2.3")).toEqual([1, 2, 3]);
    expect(parseReleaseVersion("1.2")).toBeNull();
    expect(parseReleaseVersion("v1.2.3")).toBeNull();
    expect(parseReleaseVersion(null)).toBeNull();
  });

  it("compares numerically", () => {
    expect(compareReleaseVersions("1.0.10", "1.0.9")).toBeGreaterThan(0);
    expect(compareReleaseVersions("1.0.1", "1.0.1")).toBe(0);
    expect(compareReleaseVersions("1.0.1", "2.0.0")).toBeLessThan(0);
    expect(compareReleaseVersions("1.0", "2.0.0")).toBeNull();
  });
});

describe("releaseNudgeFor", () => {
  it("never nudges when every value is null", () => {
    expect(releaseNudgeFor("1.0.1", NONE)).toEqual({ kind: "none" });
  });

  it("never nudges with an unknown installed version or no response", () => {
    expect(releaseNudgeFor(null, { ...NONE, minimumVersion: "9.9.9" })).toEqual({ kind: "none" });
    expect(releaseNudgeFor("garbage", { ...NONE, minimumVersion: "9.9.9" })).toEqual({
      kind: "none",
    });
    expect(releaseNudgeFor("1.0.1", undefined)).toEqual({ kind: "none" });
  });

  it("blocks below the minimum (wins over latest)", () => {
    expect(
      releaseNudgeFor("1.0.1", {
        latestVersion: "1.2.0",
        minimumVersion: "1.1.0",
        storeUrl: "https://apps.apple.com/app/id1",
        message: " Please update ",
      }),
    ).toEqual({
      kind: "required",
      storeUrl: "https://apps.apple.com/app/id1",
      message: "Please update",
    });
  });

  it("shows the banner below latest but at/above minimum", () => {
    expect(
      releaseNudgeFor("1.1.0", { ...NONE, latestVersion: "1.2.0", minimumVersion: "1.1.0" }),
    ).toEqual({
      kind: "available",
      latestVersion: "1.2.0",
      storeUrl: null,
      message: null,
    });
  });

  it("is quiet once installed has caught up", () => {
    expect(
      releaseNudgeFor("1.2.0", { ...NONE, latestVersion: "1.2.0", minimumVersion: "1.0.0" }),
    ).toEqual({
      kind: "none",
    });
    expect(releaseNudgeFor("2.0.0", { ...NONE, latestVersion: "1.2.0" })).toEqual({ kind: "none" });
  });
});

describe("banner dismissal", () => {
  it("matches only the dismissed latestVersion", () => {
    const flag = dismissedFlagValue("1.2.0");
    expect(isBannerDismissed(flag, "1.2.0")).toBe(true);
    expect(isBannerDismissed(flag, "1.3.0")).toBe(false);
    expect(isBannerDismissed(undefined, "1.2.0")).toBe(false);
    expect(isBannerDismissed("1.2.0", "1.2.0")).toBe(false);
  });
});

describe("fakeInstalledVersionFromSearch", () => {
  it("reads a well-formed version only", () => {
    expect(fakeInstalledVersionFromSearch("?fakeInstalledVersion=1.0.0")).toBe("1.0.0");
    expect(fakeInstalledVersionFromSearch("?fakeInstalledVersion=nope")).toBeNull();
    expect(fakeInstalledVersionFromSearch("")).toBeNull();
  });
});
