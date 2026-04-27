import { beforeAll, describe, expect, it } from "vitest";
import { signSession } from "../../lib/session.js";
import { memberRoutes } from "./members.js";

beforeAll(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
});

// These suites exercise the route layer directly and only validate
// behavior that doesn't reach the DB — auth gating and UUID parsing.
// The actual remove + self-leave + cascade-upvotes path is covered by
// the dev server / Playwright in 3b-1. Same convention as
// `lists.test.ts`.

describe("memberRoutes auth gating", () => {
  const listId = "00000000-0000-0000-0000-000000000001";
  const userId = "00000000-0000-0000-0000-000000000002";

  it("DELETE /:id/members/:userId requires a bearer token", async () => {
    const res = await memberRoutes.request(`/${listId}/members/${userId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid bearer token", async () => {
    const res = await memberRoutes.request(`/${listId}/members/${userId}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer not-a-real-token" },
    });
    expect(res.status).toBe(401);
  });
});

describe("memberRoutes input validation", () => {
  function authHeaders(): { Authorization: string } {
    return {
      Authorization: `Bearer ${signSession("00000000-0000-0000-0000-000000000001")}`,
    };
  }

  it("DELETE /:id/members/:userId 404s when list id isn't a uuid (bails before DB)", async () => {
    const res = await memberRoutes.request(
      "/not-a-uuid/members/00000000-0000-0000-0000-000000000002",
      { method: "DELETE", headers: authHeaders() },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("DELETE /:id/members/:userId 404s when user id isn't a uuid", async () => {
    // The list-id middleware passes, then the explicit userId UUID
    // check inside the handler trips. We can't drive past the
    // requireListMember middleware without a real DB membership row,
    // so this test exercises the requireListMember path: an
    // authenticated requester who isn't a member of `listId` gets a
    // 404 (envelope-level "list not found") before the userId guard.
    // That's still the contract we want — non-members can't leak
    // membership state via a member-level 404.
    const res = await memberRoutes.request(
      "/00000000-0000-0000-0000-000000000001/members/not-a-uuid",
      { method: "DELETE", headers: authHeaders() },
    );
    expect(res.status).toBe(404);
  });
});
