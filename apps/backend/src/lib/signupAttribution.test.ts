import { describe, expect, it } from "vitest";
import {
  describeSignupAttribution,
  type LinkOwnerLookup,
  resolveSignupAttribution,
  sanitizeReferrer,
  signupAcquisitionSchema,
} from "./signupAttribution.js";

const NEW_USER = "00000000-0000-4000-8000-0000000000aa";
const PHILIP = "00000000-0000-4000-8000-0000000000bb";

const owners: Record<string, string> = {
  "friend_invite:good": PHILIP,
  "play_link:play1": PHILIP,
  "list_invite:list1": PHILIP,
  "friend_invite:self": NEW_USER,
};
const lookup: LinkOwnerLookup = async (kind, token) => owners[`${kind}:${token}`] ?? null;

describe("signupAcquisitionSchema", () => {
  it("drops malformed fields one at a time, never the whole object", () => {
    expect(
      signupAcquisitionSchema.parse({
        friendInviteToken: "x".repeat(500),
        gameShareToken: "play1",
        utm: "nope",
        referrer: 42,
      }),
    ).toEqual({ gameShareToken: "play1" });
    expect(signupAcquisitionSchema.parse("garbage")).toEqual({});
    expect(signupAcquisitionSchema.optional().parse(undefined)).toBeUndefined();
  });
});

describe("sanitizeReferrer", () => {
  it("keeps origin + path, drops query and non-http", () => {
    expect(sanitizeReferrer("https://www.google.com/search?q=josh")).toBe(
      "https://www.google.com/search",
    );
    expect(sanitizeReferrer("https://t.co/")).toBe("https://t.co");
    expect(sanitizeReferrer("javascript:alert(1)")).toBeUndefined();
    expect(sanitizeReferrer("not a url")).toBeUndefined();
  });
});

describe("resolveSignupAttribution", () => {
  it("records nothing for a client that sent no acquisition", async () => {
    expect(await resolveSignupAttribution(undefined, NEW_USER, lookup)).toBeNull();
  });

  it("resolves a friend invite to the inviter, ahead of a play link", async () => {
    expect(
      await resolveSignupAttribution(
        { friendInviteToken: "good", gameShareToken: "play1" },
        NEW_USER,
        lookup,
      ),
    ).toEqual({
      source: "friend_invite",
      referredByUserId: PHILIP,
      context: { linkResolved: true },
    });
  });

  it("falls through a dead invite to a live play link", async () => {
    const got = await resolveSignupAttribution(
      { friendInviteToken: "rotated", gameShareToken: "play1" },
      NEW_USER,
      lookup,
    );
    expect(got?.source).toBe("play_link");
    expect(got?.referredByUserId).toBe(PHILIP);
  });

  it("keeps the link kind but no referrer when nothing resolves (or resolves to self)", async () => {
    expect(await resolveSignupAttribution({ friendInviteToken: "self" }, NEW_USER, lookup)).toEqual(
      { source: "friend_invite", referredByUserId: null, context: { linkResolved: false } },
    );
  });

  it("uses web context when there is no link", async () => {
    expect(
      await resolveSignupAttribution(
        {
          referrer: "https://news.ycombinator.com/item?id=1",
          landingPath: "/?utm_source=hn",
          utm: { source: "hn" },
        },
        NEW_USER,
        lookup,
      ),
    ).toEqual({
      source: "web_referral",
      referredByUserId: null,
      context: {
        referrer: "https://news.ycombinator.com/item",
        landingPath: "/",
        utm: { source: "hn" },
      },
    });
  });

  it("is `none` when the client knew nothing", async () => {
    expect(await resolveSignupAttribution({ landingPath: "/" }, NEW_USER, lookup)).toEqual({
      source: "none",
      referredByUserId: null,
      context: { landingPath: "/" },
    });
  });
});

describe("describeSignupAttribution", () => {
  const link = (source: "friend_invite" | "play_link" | "list_invite", resolved = true) => ({
    source,
    referredByUserId: resolved ? PHILIP : null,
    context: { linkResolved: resolved },
  });

  it("names the inviter and the link", () => {
    expect(describeSignupAttribution(link("friend_invite"), "Philip", "ios")).toBe(
      "invited by Philip (friend invite link)",
    );
    expect(describeSignupAttribution(link("play_link"), "Philip", "ios")).toBe(
      "via Philip's play link",
    );
    expect(describeSignupAttribution(link("list_invite"), "Philip", "web")).toBe(
      "invited by Philip (list invite)",
    );
    expect(
      describeSignupAttribution(
        { ...link("play_link"), context: { referrer: "https://www.instagram.com/" } },
        "Philip",
        "web",
      ),
    ).toBe("via Philip's play link · from instagram.com");
  });

  it("says so when the link no longer resolves", () => {
    expect(describeSignupAttribution(link("friend_invite", false), null, "ios")).toBe(
      "opened a friend invite link that no longer resolves — inviter unknown",
    );
  });

  it("shows web referrer domain and utm", () => {
    expect(
      describeSignupAttribution(
        {
          source: "web_referral",
          referredByUserId: null,
          context: { referrer: "https://news.ycombinator.com/item", utm: { source: "hn" } },
        },
        null,
        "web",
      ),
    ).toBe("from news.ycombinator.com · utm_source=hn");
  });

  it("is honest about knowing nothing", () => {
    const none = { source: "none" as const, referredByUserId: null, context: {} };
    expect(describeSignupAttribution(none, null, "ios")).toBe(
      "no referral recorded (App Store / direct)",
    );
    expect(describeSignupAttribution(none, null, "web")).toBe(
      "no referral recorded (direct web visit)",
    );
    expect(describeSignupAttribution(null, null, "ios")).toBe(
      "no referral recorded (app version predates attribution)",
    );
  });
});
