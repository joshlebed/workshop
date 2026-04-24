import { beforeAll, describe, expect, it } from "vitest";
import { signSession } from "../../lib/session.js";
import { createListSchema, listRoutes, updateListSchema } from "./lists.js";

beforeAll(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
});

describe("createListSchema", () => {
  const valid = {
    type: "movie" as const,
    name: "Date night",
    emoji: "🎬",
    color: "sunset" as const,
  };

  it("accepts a valid payload", () => {
    expect(createListSchema.safeParse(valid).success).toBe(true);
  });

  it("trims whitespace from name", () => {
    const r = createListSchema.safeParse({ ...valid, name: "  Trip  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Trip");
  });

  it("rejects an empty name", () => {
    expect(createListSchema.safeParse({ ...valid, name: "   " }).success).toBe(false);
  });

  it("rejects a name >100 chars after trim", () => {
    expect(createListSchema.safeParse({ ...valid, name: "a".repeat(101) }).success).toBe(false);
    expect(createListSchema.safeParse({ ...valid, name: "a".repeat(100) }).success).toBe(true);
  });

  it("rejects newline in name or emoji", () => {
    expect(createListSchema.safeParse({ ...valid, name: "a\nb" }).success).toBe(false);
    expect(createListSchema.safeParse({ ...valid, emoji: "🎬\n" }).success).toBe(false);
  });

  it("rejects unknown color keys", () => {
    expect(
      createListSchema.safeParse({ ...valid, color: "magenta" as unknown as "sunset" }).success,
    ).toBe(false);
  });

  it("rejects unknown list types", () => {
    expect(
      createListSchema.safeParse({ ...valid, type: "podcast" as unknown as "movie" }).success,
    ).toBe(false);
  });

  it("accepts an optional description and clamps it at 280 chars", () => {
    expect(createListSchema.safeParse({ ...valid, description: "a".repeat(280) }).success).toBe(
      true,
    );
    expect(createListSchema.safeParse({ ...valid, description: "a".repeat(281) }).success).toBe(
      false,
    );
  });
});

describe("updateListSchema", () => {
  it("accepts a single-field patch", () => {
    expect(updateListSchema.safeParse({ name: "renamed" }).success).toBe(true);
  });

  it("rejects an empty patch", () => {
    expect(updateListSchema.safeParse({}).success).toBe(false);
  });

  it("allows clearing description with null", () => {
    const r = updateListSchema.safeParse({ description: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.description).toBeNull();
  });

  it("rejects unknown color keys", () => {
    expect(updateListSchema.safeParse({ color: "neon" }).success).toBe(false);
  });
});

// These two suites exercise the route layer directly and only validate
// behavior that doesn't reach the DB — auth gating and JSON parsing. The DB
// path is covered by the dev server / Playwright in 1b. Same convention as
// `users.test.ts` / `auth.test.ts`.
describe("listRoutes auth gating", () => {
  it("GET / requires a bearer token", async () => {
    const res = await listRoutes.request("/", { method: "GET" });
    expect(res.status).toBe(401);
  });

  it("POST / requires a bearer token", async () => {
    const res = await listRoutes.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid bearer token", async () => {
    const res = await listRoutes.request("/", {
      method: "GET",
      headers: { Authorization: "Bearer not-a-real-token" },
    });
    expect(res.status).toBe(401);
  });
});

describe("listRoutes input validation", () => {
  function authHeaders(): { Authorization: string; "Content-Type": string } {
    return {
      Authorization: `Bearer ${signSession("00000000-0000-0000-0000-000000000001")}`,
      "Content-Type": "application/json",
    };
  }

  it("POST / 400s on a non-JSON body", async () => {
    const res = await listRoutes.request("/", {
      method: "POST",
      headers: authHeaders(),
      body: "not json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "VALIDATION" });
  });

  it("POST / 400s on a missing required field", async () => {
    const res = await listRoutes.request("/", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ type: "movie", name: "x", color: "sunset" }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /:id 404s when id isn't a uuid (bails before DB)", async () => {
    const res = await listRoutes.request("/not-a-uuid", {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ name: "renamed" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("DELETE /:id 404s when id isn't a uuid (bails before DB)", async () => {
    const res = await listRoutes.request("/not-a-uuid", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("GET /:id 404s when id isn't a uuid (bails before DB)", async () => {
    const res = await listRoutes.request("/not-a-uuid", {
      method: "GET",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});
