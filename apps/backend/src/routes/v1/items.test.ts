import { beforeAll, describe, expect, it } from "vitest";
import { signSession } from "../../lib/session.js";
import { createItemSchema, itemRoutes, updateItemSchema } from "./items.js";
import { listRoutes } from "./lists.js";

beforeAll(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
});

describe("createItemSchema", () => {
  it("accepts a minimal payload", () => {
    expect(createItemSchema.safeParse({ title: "Watch Dune" }).success).toBe(true);
  });

  it("trims whitespace from title", () => {
    const r = createItemSchema.safeParse({ title: "  Read  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.title).toBe("Read");
  });

  it("rejects an empty title", () => {
    expect(createItemSchema.safeParse({ title: "   " }).success).toBe(false);
  });

  it("rejects a title >500 chars after trim", () => {
    expect(createItemSchema.safeParse({ title: "a".repeat(501) }).success).toBe(false);
    expect(createItemSchema.safeParse({ title: "a".repeat(500) }).success).toBe(true);
  });

  it("rejects newline in title", () => {
    expect(createItemSchema.safeParse({ title: "a\nb" }).success).toBe(false);
  });

  it("accepts optional url and clamps it at 2048 chars", () => {
    expect(createItemSchema.safeParse({ title: "x", url: "a".repeat(2048) }).success).toBe(true);
    expect(createItemSchema.safeParse({ title: "x", url: "a".repeat(2049) }).success).toBe(false);
  });

  it("accepts optional note and clamps it at 1000 chars", () => {
    expect(createItemSchema.safeParse({ title: "x", note: "a".repeat(1000) }).success).toBe(true);
    expect(createItemSchema.safeParse({ title: "x", note: "a".repeat(1001) }).success).toBe(false);
  });

  it("accepts optional metadata as a record", () => {
    const r = createItemSchema.safeParse({
      title: "x",
      metadata: { source: "tmdb", year: 2024 },
    });
    expect(r.success).toBe(true);
  });

  it("rejects metadata that isn't an object", () => {
    expect(createItemSchema.safeParse({ title: "x", metadata: ["a", "b"] }).success).toBe(false);
    expect(createItemSchema.safeParse({ title: "x", metadata: "string" }).success).toBe(false);
  });
});

describe("updateItemSchema", () => {
  it("accepts a single-field patch", () => {
    expect(updateItemSchema.safeParse({ title: "renamed" }).success).toBe(true);
  });

  it("rejects an empty patch", () => {
    expect(updateItemSchema.safeParse({}).success).toBe(false);
  });

  it("allows clearing url with null", () => {
    const r = updateItemSchema.safeParse({ url: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.url).toBeNull();
  });

  it("allows clearing note with null", () => {
    const r = updateItemSchema.safeParse({ note: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.note).toBeNull();
  });

  it("rejects newline in title", () => {
    expect(updateItemSchema.safeParse({ title: "a\nb" }).success).toBe(false);
  });
});

describe("itemRoutes auth gating", () => {
  it("GET /:id requires a bearer token", async () => {
    const res = await itemRoutes.request("/00000000-0000-0000-0000-000000000001", {
      method: "GET",
    });
    expect(res.status).toBe(401);
  });

  it("PATCH /:id requires a bearer token", async () => {
    const res = await itemRoutes.request("/00000000-0000-0000-0000-000000000001", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /:id/upvote requires a bearer token", async () => {
    const res = await itemRoutes.request("/00000000-0000-0000-0000-000000000001/upvote", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("POST /:id/complete requires a bearer token", async () => {
    const res = await itemRoutes.request("/00000000-0000-0000-0000-000000000001/complete", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });
});

describe("itemRoutes input validation", () => {
  function authHeaders(): { Authorization: string; "Content-Type": string } {
    return {
      Authorization: `Bearer ${signSession("00000000-0000-0000-0000-000000000001")}`,
      "Content-Type": "application/json",
    };
  }

  // requireItemMember bails before DB on a non-uuid path param, so these
  // cases don't need a live DB.
  it("GET /:id 404s when id isn't a uuid", async () => {
    const res = await itemRoutes.request("/not-a-uuid", {
      method: "GET",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("PATCH /:id 404s when id isn't a uuid", async () => {
    const res = await itemRoutes.request("/not-a-uuid", {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /:id 404s when id isn't a uuid", async () => {
    const res = await itemRoutes.request("/not-a-uuid", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("POST /:id/upvote 404s when id isn't a uuid", async () => {
    const res = await itemRoutes.request("/not-a-uuid/upvote", {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /:id/upvote 404s when id isn't a uuid", async () => {
    const res = await itemRoutes.request("/not-a-uuid/upvote", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("POST /:id/complete 404s when id isn't a uuid", async () => {
    const res = await itemRoutes.request("/not-a-uuid/complete", {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("POST /:id/uncomplete 404s when id isn't a uuid", async () => {
    const res = await itemRoutes.request("/not-a-uuid/uncomplete", {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

// List-scoped item routes live on `listRoutes` (mounted at /v1/lists). These
// only verify auth-gating + uuid bail-out — same convention as lists.test.ts.
describe("list-scoped item routes auth gating", () => {
  it("GET /:id/items requires a bearer token", async () => {
    const res = await listRoutes.request("/00000000-0000-0000-0000-000000000001/items", {
      method: "GET",
    });
    expect(res.status).toBe(401);
  });

  it("POST /:id/items requires a bearer token", async () => {
    const res = await listRoutes.request("/00000000-0000-0000-0000-000000000001/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(401);
  });

  function authHeaders(): { Authorization: string; "Content-Type": string } {
    return {
      Authorization: `Bearer ${signSession("00000000-0000-0000-0000-000000000001")}`,
      "Content-Type": "application/json",
    };
  }

  it("GET /:id/items 404s when list id isn't a uuid", async () => {
    const res = await listRoutes.request("/not-a-uuid/items", {
      method: "GET",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("POST /:id/items 404s when list id isn't a uuid", async () => {
    const res = await listRoutes.request("/not-a-uuid/items", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(404);
  });
});
