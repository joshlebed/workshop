import { beforeAll, describe, expect, it } from "vitest";
import { signSession } from "../../lib/session.js";
import { inviteRoutes, publicInviteRoutes } from "./invites.js";

beforeAll(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
});

// New invite tokens are no longer minted — sharing is via `lists.share_slug`
// (see `lists.ts`). These tests guard the legacy `accept` + `preview`
// surface that remains live for already-shared URLs.
describe("legacy inviteRoutes auth gating", () => {
  it("POST /invites/:token/accept requires a bearer token", async () => {
    const res = await inviteRoutes.request("/invites/some-token-value/accept", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid bearer token", async () => {
    const res = await inviteRoutes.request("/invites/some-token-value/accept", {
      method: "POST",
      headers: { Authorization: "Bearer not-a-real-token" },
    });
    expect(res.status).toBe(401);
  });
});

describe("legacy inviteRoutes input validation", () => {
  function authHeaders(): { Authorization: string; "Content-Type": string } {
    return {
      Authorization: `Bearer ${signSession("00000000-0000-0000-0000-000000000001")}`,
      "Content-Type": "application/json",
    };
  }

  it("POST /invites/:token/accept 404s on an overlong token (bails before DB)", async () => {
    const res = await inviteRoutes.request(`/invites/${"a".repeat(300)}/accept`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

describe("publicInviteRoutes (no auth)", () => {
  it("GET /invites/:token/preview does not require a bearer token", async () => {
    const res = await publicInviteRoutes.request(`/invites/${"a".repeat(300)}/preview`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
  });
});
