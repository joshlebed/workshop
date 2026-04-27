import { beforeAll, describe, expect, it } from "vitest";
import { signSession } from "../../lib/session.js";
import { createInviteSchema, inviteRoutes } from "./invites.js";

beforeAll(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
});

describe("createInviteSchema", () => {
  it("accepts an empty body", () => {
    expect(createInviteSchema.safeParse(undefined).success).toBe(true);
  });

  it("accepts an empty object", () => {
    expect(createInviteSchema.safeParse({}).success).toBe(true);
  });

  it("accepts an explicit null email (forward-compat)", () => {
    expect(createInviteSchema.safeParse({ email: null }).success).toBe(true);
  });

  it("accepts a valid email (ignored at the handler in v1)", () => {
    expect(createInviteSchema.safeParse({ email: "friend@example.com" }).success).toBe(true);
  });

  it("rejects a malformed email", () => {
    expect(createInviteSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
  });

  it("rejects an absurdly long email", () => {
    expect(createInviteSchema.safeParse({ email: `${"a".repeat(320)}@example.com` }).success).toBe(
      false,
    );
  });
});

// These suites exercise the route layer directly and only validate
// behavior that doesn't reach the DB — auth gating and JSON parsing.
// The DB path (token generation, accept idempotence, owner-only revoke)
// is covered by the dev server / Playwright in 3b-1. Same convention as
// `lists.test.ts`.
describe("inviteRoutes auth gating", () => {
  const validListId = "00000000-0000-0000-0000-000000000001";

  it("POST /lists/:id/invites requires a bearer token", async () => {
    const res = await inviteRoutes.request(`/lists/${validListId}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("DELETE /lists/:id/invites/:inviteId requires a bearer token", async () => {
    const res = await inviteRoutes.request(`/lists/${validListId}/invites/${validListId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

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

describe("inviteRoutes input validation", () => {
  function authHeaders(): { Authorization: string; "Content-Type": string } {
    return {
      Authorization: `Bearer ${signSession("00000000-0000-0000-0000-000000000001")}`,
      "Content-Type": "application/json",
    };
  }

  it("POST /lists/:id/invites 404s when list id isn't a uuid (bails before DB)", async () => {
    const res = await inviteRoutes.request("/lists/not-a-uuid/invites", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("DELETE /lists/:id/invites/:inviteId 404s when list id isn't a uuid", async () => {
    const res = await inviteRoutes.request(
      "/lists/not-a-uuid/invites/00000000-0000-0000-0000-000000000002",
      { method: "DELETE", headers: authHeaders() },
    );
    expect(res.status).toBe(404);
  });

  it("POST /invites/:token/accept 404s on an empty-ish path", async () => {
    // Hono path-param routing won't match an empty segment, but
    // overlong tokens should hit our explicit length guard.
    const res = await inviteRoutes.request(`/invites/${"a".repeat(300)}/accept`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});
