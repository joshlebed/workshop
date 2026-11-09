import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("./storage", () => ({
  getItem: vi.fn(async (k: string) => store.get(k) ?? null),
  setItem: vi.fn(async (k: string, v: string) => void store.set(k, v)),
  removeItem: vi.fn(async (k: string) => void store.delete(k)),
}));

const { clearSignupLanding, collectSignupAcquisition, landingFromLocation } = await import(
  "./signupAcquisition"
);

describe("landingFromLocation", () => {
  it("keeps a cross-site referrer, the path and utm params", () => {
    expect(
      landingFromLocation(
        "https://highscore.live/friends/accept/abc?utm_source=tiktok&utm_campaign=launch&x=1",
        "https://www.tiktok.com/@someone/video/1?q=secret",
      ),
    ).toEqual({
      landingPath: "/friends/accept/abc",
      referrer: "https://www.tiktok.com/@someone/video/1",
      utm: { source: "tiktok", campaign: "launch" },
    });
  });

  it("drops a same-site referrer and junk", () => {
    expect(
      landingFromLocation("https://highscore.live/", "https://highscore.live/sign-in"),
    ).toEqual({ landingPath: "/" });
    expect(landingFromLocation("https://highscore.live/", "not a url")).toEqual({
      landingPath: "/",
    });
    expect(landingFromLocation("nope", "")).toEqual({});
  });
});

describe("collectSignupAcquisition", () => {
  beforeEach(() => store.clear());

  it("is an empty object when nothing is known", async () => {
    expect(await collectSignupAcquisition({ friendInvite: "f", gameShare: "g" })).toEqual({});
  });

  it("merges pending link tokens with the stashed landing", async () => {
    store.set("f", "tok123");
    store.set(
      "workshop.signup-landing",
      JSON.stringify({ referrer: "https://t.co/x", landingPath: "/g/abc", utm: { source: "x" } }),
    );
    expect(await collectSignupAcquisition({ friendInvite: "f", gameShare: "g" })).toEqual({
      friendInviteToken: "tok123",
      referrer: "https://t.co/x",
      landingPath: "/g/abc",
      utm: { source: "x" },
    });
    await clearSignupLanding();
    expect(await collectSignupAcquisition({ friendInvite: "f" })).toEqual({
      friendInviteToken: "tok123",
    });
  });

  it("ignores a corrupt landing stash", async () => {
    store.set("workshop.signup-landing", "{not json");
    expect(await collectSignupAcquisition({})).toEqual({});
  });
});
