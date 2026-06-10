import { beforeAll, describe, expect, it } from "vitest";
import { signSession } from "../../lib/session.js";
import { __test, listViewRoutes } from "./views.js";

beforeAll(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
});

const validUuid = "00000000-0000-4000-8000-000000000001";
const viewUuid = "00000000-0000-4000-8000-000000000002";

function authHeaders(): { Authorization: string; "Content-Type": string } {
  return {
    Authorization: `Bearer ${signSession(validUuid)}`,
    "Content-Type": "application/json",
  };
}

// Like the items suite, these exercise the schema + auth/uuid-gating layer
// directly. Driving a route past `requireListMember` to its handler needs a
// live DB, so creator/owner permission + position assignment are covered by
// the schema tests here plus the e2e flow (tests/e2e/saved-views.spec.ts).

describe("createViewSchema", () => {
  const { createViewSchema } = __test;

  it("accepts a minimal valid payload (name + tags)", () => {
    const r = createViewSchema.safeParse({ name: "Burgers", config: { tags: ["burgers"] } });
    expect(r.success).toBe(true);
  });

  it("accepts an empty tag set (a view that matches everything)", () => {
    const r = createViewSchema.safeParse({ name: "All", config: { tags: [] } });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.config.tags).toEqual([]);
  });

  it("trims whitespace from the name", () => {
    const r = createViewSchema.safeParse({ name: "  Cocktail bars ", config: { tags: [] } });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Cocktail bars");
  });

  it("rejects an empty / whitespace name", () => {
    expect(createViewSchema.safeParse({ name: "   ", config: { tags: [] } }).success).toBe(false);
    expect(createViewSchema.safeParse({ name: "", config: { tags: [] } }).success).toBe(false);
  });

  it("rejects newlines in the name", () => {
    expect(createViewSchema.safeParse({ name: "a\nb", config: { tags: [] } }).success).toBe(false);
  });

  it("clamps the name at 60 chars after trim", () => {
    expect(createViewSchema.safeParse({ name: "a".repeat(60), config: { tags: [] } }).success).toBe(
      true,
    );
    expect(createViewSchema.safeParse({ name: "a".repeat(61), config: { tags: [] } }).success).toBe(
      false,
    );
  });

  it("normalizes tags (trim, lowercase, collapse whitespace) like item tags", () => {
    const r = createViewSchema.safeParse({
      name: "x",
      config: { tags: ["  Burgers ", "Date   Night"] },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.config.tags).toEqual(["burgers", "date night"]);
  });

  it("dedupes after normalization and sorts the tag set", () => {
    const r = createViewSchema.safeParse({
      name: "x",
      config: { tags: ["zest", "Burgers", " burgers", "BURGERS"] },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.config.tags).toEqual(["burgers", "zest"]);
  });

  it("rejects a tag empty after trim", () => {
    expect(createViewSchema.safeParse({ name: "x", config: { tags: ["   "] } }).success).toBe(
      false,
    );
  });

  it("clamps tag length at 40 chars post-normalization", () => {
    expect(
      createViewSchema.safeParse({ name: "x", config: { tags: ["a".repeat(40)] } }).success,
    ).toBe(true);
    expect(
      createViewSchema.safeParse({ name: "x", config: { tags: ["a".repeat(41)] } }).success,
    ).toBe(false);
  });

  it("rejects more than 20 tags", () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag-${i}`);
    expect(createViewSchema.safeParse({ name: "x", config: { tags } }).success).toBe(false);
  });

  it("requires the config object", () => {
    expect(createViewSchema.safeParse({ name: "x" }).success).toBe(false);
  });

  it("requires the tags array inside config", () => {
    expect(createViewSchema.safeParse({ name: "x", config: {} }).success).toBe(false);
  });

  it("round-trips an optional sort, trimmed", () => {
    const r = createViewSchema.safeParse({
      name: "x",
      config: { tags: ["a"], sort: "  upvotes " },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.config).toEqual({ tags: ["a"], sort: "upvotes" });
  });

  it("omits sort from the normalized config when absent", () => {
    const r = createViewSchema.safeParse({ name: "x", config: { tags: ["a"] } });
    expect(r.success).toBe(true);
    if (r.success) expect("sort" in r.data.config).toBe(false);
  });
});

describe("updateViewSchema", () => {
  const { updateViewSchema } = __test;

  it("accepts a name-only patch", () => {
    expect(updateViewSchema.safeParse({ name: "Renamed" }).success).toBe(true);
  });

  it("accepts a config-only patch", () => {
    expect(updateViewSchema.safeParse({ config: { tags: ["cozy"] } }).success).toBe(true);
  });

  it("rejects an empty patch", () => {
    expect(updateViewSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a newline name", () => {
    expect(updateViewSchema.safeParse({ name: "a\nb" }).success).toBe(false);
  });
});

describe("listViewRoutes auth gating", () => {
  it("GET /:id/views requires a bearer token", async () => {
    const res = await listViewRoutes.request(`/${validUuid}/views`);
    expect(res.status).toBe(401);
  });

  it("POST /:id/views requires a bearer token", async () => {
    const res = await listViewRoutes.request(`/${validUuid}/views`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", config: { tags: [] } }),
    });
    expect(res.status).toBe(401);
  });

  it("PATCH /:id/views/:viewId requires a bearer token", async () => {
    const res = await listViewRoutes.request(`/${validUuid}/views/${viewUuid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("DELETE /:id/views/:viewId requires a bearer token", async () => {
    const res = await listViewRoutes.request(`/${validUuid}/views/${viewUuid}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid bearer token", async () => {
    const res = await listViewRoutes.request(`/${validUuid}/views`, {
      headers: { Authorization: "Bearer not-a-real-token" },
    });
    expect(res.status).toBe(401);
  });
});

describe("listViewRoutes input gating (bails before DB)", () => {
  it("GET /:id/views 404s when the list id isn't a uuid", async () => {
    const res = await listViewRoutes.request("/not-a-uuid/views", { headers: authHeaders() });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("POST /:id/views 404s when the list id isn't a uuid", async () => {
    const res = await listViewRoutes.request("/not-a-uuid/views", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "x", config: { tags: [] } }),
    });
    expect(res.status).toBe(404);
  });

  it("PATCH /:id/views/:viewId 404s when the list id isn't a uuid", async () => {
    const res = await listViewRoutes.request(`/not-a-uuid/views/${viewUuid}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ name: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /:id/views/:viewId 404s when the list id isn't a uuid", async () => {
    const res = await listViewRoutes.request(`/not-a-uuid/views/${viewUuid}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});
