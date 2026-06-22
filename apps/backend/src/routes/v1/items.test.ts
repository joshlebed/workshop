import type { LinkPreview } from "@workshop/shared";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { requireModule, stripModuleGatedItemFields } from "../../lib/moduleGate.js";
import { signSession } from "../../lib/session.js";
import { __test, createItemSchema, itemRoutes } from "./items.js";
import { listRoutes } from "./lists.js";

beforeAll(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
});

const validUuid = "00000000-0000-4000-8000-000000000001";

function authHeaders(): { Authorization: string; "Content-Type": string } {
  return {
    Authorization: `Bearer ${signSession(validUuid)}`,
    "Content-Type": "application/json",
  };
}

// These suites exercise the route + helper layer directly: schema validation,
// auth gating, UUID parsing, the module-gate 409 contract, and content
// validation against the kind registry. Module-gate assertions hit the helper
// (`requireModule`) since driving the route to the handler requires a live DB
// (see the convention notes on `activity.test.ts` / `members.test.ts`).

describe("createItemSchema", () => {
  it("accepts a minimal payload (title only)", () => {
    expect(createItemSchema.safeParse({ title: "Watch Dune" }).success).toBe(true);
  });

  it("trims whitespace from title", () => {
    const r = createItemSchema.safeParse({ title: "  Read  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.title).toBe("Read");
  });

  it("rejects empty / whitespace title", () => {
    expect(createItemSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(createItemSchema.safeParse({ title: "" }).success).toBe(false);
  });

  it("rejects newlines in title", () => {
    expect(createItemSchema.safeParse({ title: "a\nb" }).success).toBe(false);
    expect(createItemSchema.safeParse({ title: "a\r\nb" }).success).toBe(false);
  });

  it("rejects a title longer than 500 chars after trim", () => {
    expect(createItemSchema.safeParse({ title: "a".repeat(500) }).success).toBe(true);
    expect(createItemSchema.safeParse({ title: "a".repeat(501) }).success).toBe(false);
  });

  it("accepts a kind override from the registry", () => {
    const r = createItemSchema.safeParse({ title: "x", kind: "movie" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.kind).toBe("movie");
  });

  it("rejects an unknown kind", () => {
    expect(createItemSchema.safeParse({ title: "x", kind: "vinyl" }).success).toBe(false);
  });

  it("clamps url at 2048 chars", () => {
    expect(createItemSchema.safeParse({ title: "x", url: "a".repeat(2048) }).success).toBe(true);
    expect(createItemSchema.safeParse({ title: "x", url: "a".repeat(2049) }).success).toBe(false);
  });

  it("clamps note at 1000 chars", () => {
    expect(createItemSchema.safeParse({ title: "x", note: "a".repeat(1000) }).success).toBe(true);
    expect(createItemSchema.safeParse({ title: "x", note: "a".repeat(1001) }).success).toBe(false);
  });

  it("accepts content as a record", () => {
    const r = createItemSchema.safeParse({
      title: "x",
      kind: "movie",
      content: { source: "tmdb", year: 2024 },
    });
    expect(r.success).toBe(true);
  });

  it("rejects content that isn't an object", () => {
    expect(createItemSchema.safeParse({ title: "x", content: ["a", "b"] }).success).toBe(false);
    expect(createItemSchema.safeParse({ title: "x", content: "blob" }).success).toBe(false);
  });
});

describe("updateItemSchema", () => {
  const { updateItemSchema } = __test;

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

  it("rejects newlines in title", () => {
    expect(updateItemSchema.safeParse({ title: "a\nb" }).success).toBe(false);
  });

  it("accepts a kind change", () => {
    const r = updateItemSchema.safeParse({ kind: "book" });
    expect(r.success).toBe(true);
  });
});

describe("link-preview content refresh helpers", () => {
  const preview: LinkPreview = {
    url: "https://example.com/game",
    finalUrl: "https://example.com/game",
    title: "New game",
    description: "A better preview",
    image: "https://cdn.example/new.png",
    imageProxy: "https://wsrv.nl/?url=cdn.example/new.png",
    favicon: "https://icons.example/favicon.png",
    siteName: "Example",
    source: "html",
    fetchedAt: "2026-05-19T00:00:00.000Z",
  };

  it("replaces stale preview fields and preserves unrelated content", () => {
    expect(
      __test.mergeLinkPreviewContent(
        {
          source: "link_preview",
          sourceId: "https://old.example",
          image: "https://old.example/old.png",
          imageProxy: "https://old.example/proxy.png",
          thumbnailUrl: "https://old.example/thumb.png",
          siteName: "Old site",
          title: "Old title",
          description: "Old description",
          lat: 40.7,
          lng: -74,
        },
        preview,
      ),
    ).toEqual({
      source: "link_preview",
      sourceId: "https://example.com/game",
      image: "https://cdn.example/new.png",
      imageProxy: "https://wsrv.nl/?url=cdn.example/new.png",
      thumbnailUrl: "https://wsrv.nl/?url=cdn.example/new.png",
      siteName: "Example",
      title: "New game",
      description: "A better preview",
      lat: 40.7,
      lng: -74,
    });
  });

  it("uses favicon as the thumbnail fallback when no preview image exists", () => {
    const content = __test.linkPreviewToContent({
      ...preview,
      image: null,
      imageProxy: null,
    });

    expect(content.thumbnailUrl).toBe("https://icons.example/favicon.png");
    expect(content.image).toBeUndefined();
    expect(content.imageProxy).toBeUndefined();
  });

  it("produces content that passes linkContent validation for a long resolved URL", () => {
    // Google Maps shortlinks (`https://maps.app.goo.gl/...`) expand into
    // `https://www.google.com/maps/place/...` URLs that easily exceed 128
    // chars. Regression test: the schema must accept this as `sourceId`.
    const longFinalUrl = `https://www.google.com/maps/place/Royale/@40.7505,-73.9934,17z/data=${"a".repeat(
      400,
    )}`;
    expect(longFinalUrl.length).toBeGreaterThan(128);
    const content = __test.linkPreviewToContent({
      ...preview,
      finalUrl: longFinalUrl,
    });
    expect(() => validateContent("link", content)).not.toThrow();
  });

  it("produces valid link content when preview text exceeds write limits", () => {
    const content = __test.linkPreviewToContent({
      ...preview,
      title: "t".repeat(833),
      description: "d".repeat(2500),
      siteName: "s".repeat(250),
    });
    expect(() => validateContent("link", content)).not.toThrow();
    expect(content.title).toBe("t".repeat(500));
    expect(content.description).toBe("d".repeat(2000));
    expect(content.siteName).toBe("s".repeat(200));
  });

  it("clears preview-owned fields when a URL is cleared or preview refresh fails", () => {
    expect(
      __test.clearLinkPreviewContent({
        source: "link_preview",
        sourceId: "https://old.example",
        thumbnailUrl: "https://old.example/thumb.png",
        siteName: "Old site",
        lat: 40.7,
      }),
    ).toEqual({ lat: 40.7 });
  });
});

describe("moveItemSchema", () => {
  const { moveItemSchema } = __test;

  it("accepts both fields as null (demote to unordered)", () => {
    expect(moveItemSchema.safeParse({ beforeItemId: null, afterItemId: null }).success).toBe(true);
  });

  it("accepts only beforeItemId", () => {
    expect(moveItemSchema.safeParse({ beforeItemId: validUuid }).success).toBe(true);
  });

  it("accepts only afterItemId", () => {
    expect(moveItemSchema.safeParse({ afterItemId: validUuid }).success).toBe(true);
  });

  it("accepts both as uuids (insert between)", () => {
    expect(
      moveItemSchema.safeParse({ beforeItemId: validUuid, afterItemId: validUuid }).success,
    ).toBe(true);
  });

  it("rejects non-uuid in beforeItemId", () => {
    expect(moveItemSchema.safeParse({ beforeItemId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects non-uuid in afterItemId", () => {
    expect(moveItemSchema.safeParse({ afterItemId: "garbage" }).success).toBe(false);
  });

  it("accepts an empty object (treated as demote)", () => {
    expect(moveItemSchema.safeParse({}).success).toBe(true);
  });
});

describe("updateItemTagsSchema", () => {
  const { updateItemTagsSchema } = __test;

  it("accepts an empty set (clears every tag)", () => {
    const r = updateItemTagsSchema.safeParse({ tags: [] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tags).toEqual([]);
  });

  it("normalizes: trims, lowercases, collapses internal whitespace", () => {
    const r = updateItemTagsSchema.safeParse({ tags: ["  Burgers ", "Date   Night"] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tags).toEqual(["burgers", "date night"]);
  });

  it("dedupes after normalization and sorts the set", () => {
    const r = updateItemTagsSchema.safeParse({ tags: ["zest", "Burgers", " burgers", "BURGERS"] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tags).toEqual(["burgers", "zest"]);
  });

  it("rejects a tag that is empty after trim", () => {
    expect(updateItemTagsSchema.safeParse({ tags: ["   "] }).success).toBe(false);
  });

  it("clamps tag length at 40 chars post-normalization", () => {
    expect(updateItemTagsSchema.safeParse({ tags: ["a".repeat(40)] }).success).toBe(true);
    expect(updateItemTagsSchema.safeParse({ tags: ["a".repeat(41)] }).success).toBe(false);
  });

  it("rejects more than 20 tags", () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag-${i}`);
    expect(updateItemTagsSchema.safeParse({ tags }).success).toBe(false);
  });

  it("rejects a missing tags field", () => {
    expect(updateItemTagsSchema.safeParse({}).success).toBe(false);
  });

  it("rejects non-string entries", () => {
    expect(updateItemTagsSchema.safeParse({ tags: [42] }).success).toBe(false);
  });
});

describe("itemRoutes auth gating", () => {
  it("GET /:id requires a bearer token", async () => {
    const res = await itemRoutes.request(`/${validUuid}`);
    expect(res.status).toBe(401);
  });

  it("PATCH /:id requires a bearer token", async () => {
    const res = await itemRoutes.request(`/${validUuid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("DELETE /:id requires a bearer token", async () => {
    const res = await itemRoutes.request(`/${validUuid}`, { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  it("POST /:id/complete requires a bearer token", async () => {
    const res = await itemRoutes.request(`/${validUuid}/complete`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("POST /:id/uncomplete requires a bearer token", async () => {
    const res = await itemRoutes.request(`/${validUuid}/uncomplete`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("POST /:id/move requires a bearer token", async () => {
    const res = await itemRoutes.request(`/${validUuid}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("PUT /:id/tags requires a bearer token", async () => {
    const res = await itemRoutes.request(`/${validUuid}/tags`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["burgers"] }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid bearer token", async () => {
    const res = await itemRoutes.request(`/${validUuid}`, {
      headers: { Authorization: "Bearer not-a-real-token" },
    });
    expect(res.status).toBe(401);
  });
});

describe("itemRoutes input validation (bails before DB)", () => {
  it("GET /:id 404s when id isn't a uuid", async () => {
    const res = await itemRoutes.request("/not-a-uuid", { headers: authHeaders() });
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

  it("POST /:id/complete 404s when id isn't a uuid", async () => {
    const res = await itemRoutes.request("/not-a-uuid/complete", {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("POST /:id/move 404s when id isn't a uuid", async () => {
    const res = await itemRoutes.request("/not-a-uuid/move", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it("PUT /:id/tags 404s when id isn't a uuid", async () => {
    const res = await itemRoutes.request("/not-a-uuid/tags", {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ tags: ["burgers"] }),
    });
    expect(res.status).toBe(404);
  });
});

// --- List-scoped item routes (POST /v1/lists/:id/items, etc.) ---

describe("list-scoped item routes auth + uuid gating", () => {
  it("GET /:id/items requires a bearer token", async () => {
    const res = await listRoutes.request(`/${validUuid}/items`);
    expect(res.status).toBe(401);
  });

  it("POST /:id/items requires a bearer token", async () => {
    const res = await listRoutes.request(`/${validUuid}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /:id/items/bulk requires a bearer token", async () => {
    const res = await listRoutes.request(`/${validUuid}/items/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ title: "x" }] }),
    });
    expect(res.status).toBe(401);
  });

  it("GET /:id/items 404s when list id isn't a uuid", async () => {
    const res = await listRoutes.request("/not-a-uuid/items", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("GET /:id/tags requires a bearer token", async () => {
    const res = await listRoutes.request(`/${validUuid}/tags`);
    expect(res.status).toBe(401);
  });

  it("GET /:id/tags 404s when list id isn't a uuid", async () => {
    const res = await listRoutes.request("/not-a-uuid/tags", {
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

// --- Module gate 409 contract (§5.1) ---
//
// `requireModule` is the route-layer helper every gated endpoint calls. The
// contract: a 409 Response whose JSON body carries a stable `<module>.disabled`
// code, the module name, and a server-authored message. Driving the route to
// the handler requires a live DB, so we assert against the helper directly —
// each gated endpoint (`complete`, `move`, `score`, `sources`) flows through
// this. The "3+ assertions per gated endpoint" coverage: status, top-level
// envelope, and the embedded `code`/`module`/`message`.

function makeContext(): { ctx: Parameters<typeof requireModule>[0] } {
  const app = new Hono();
  let captured: unknown;
  app.get("/__cap", (c) => {
    captured = c;
    return c.text("ok");
  });
  // Hono doesn't expose a Context builder; the simplest seam is to handle a
  // synthetic GET and pluck the context out of the closure.
  void app.request("/__cap");
  return { ctx: captured as Parameters<typeof requireModule>[0] };
}

async function expect409<M extends "todo" | "ranking" | "leaderboard" | "sources">(
  module: M,
): Promise<void> {
  const app = new Hono();
  app.get("/x", (c) => {
    const r = requireModule(c, [], module);
    if (r) return r;
    return c.text("never");
  });
  const res = await app.request("/x");
  expect(res.status).toBe(409);
  const body = (await res.json()) as {
    error: string;
    code: string;
    details: { code: string; module: string; message: string };
  };
  expect(body).toMatchObject({ error: "module_disabled", code: "CONFLICT" });
  expect(body.details.code).toBe(`${module}.disabled`);
  expect(body.details.module).toBe(module);
  expect(body.details.message.length).toBeGreaterThan(0);
}

describe("module-gate 409 contract (requireModule)", () => {
  // `makeContext` is unused but documents the alternative path; leave it
  // here in case a future test wants a raw Context object.
  void makeContext;

  it("todo: returns 409 with todo.disabled code", async () => {
    await expect409("todo");
  });

  it("ranking: returns 409 with ranking.disabled code", async () => {
    await expect409("ranking");
  });

  it("leaderboard: returns 409 with leaderboard.disabled code", async () => {
    await expect409("leaderboard");
  });

  it("sources: returns 409 with sources.disabled code", async () => {
    await expect409("sources");
  });

  it("returns null (pass-through) when the module is enabled", async () => {
    const app = new Hono();
    app.get("/x", (c) => {
      const r = requireModule(c, ["todo"], "todo");
      return c.json({ blocked: r !== null });
    });
    const res = await app.request("/x");
    const body = (await res.json()) as { blocked: boolean };
    expect(body.blocked).toBe(false);
  });

  it("treats extra unrelated modules as still gated when target isn't present", async () => {
    const app = new Hono();
    app.get("/x", (c) => {
      const r = requireModule(c, ["ranking", "sources"], "todo");
      return c.json({ blocked: r !== null });
    });
    const res = await app.request("/x");
    const body = (await res.json()) as { blocked: boolean };
    expect(body.blocked).toBe(true);
  });
});

describe("stripModuleGatedItemFields", () => {
  // Items in the wire response drop fields whose gating module is off so
  // clients never accidentally render preserved-but-hidden data (§5.1).
  const base = {
    id: "i",
    title: "x",
    completed: true,
    completedAt: "2026-05-01T00:00:00Z",
    completedBy: "u",
    position: 1024,
  };

  it("strips todo fields when todo is off", () => {
    const r = stripModuleGatedItemFields(base, ["ranking"]);
    expect(r.completed).toBeUndefined();
    expect(r.completedAt).toBeUndefined();
    expect(r.completedBy).toBeUndefined();
    expect(r.position).toBe(1024);
  });

  it("strips position when ranking is off", () => {
    const r = stripModuleGatedItemFields(base, ["todo"]);
    expect(r.position).toBeUndefined();
    expect(r.completed).toBe(true);
  });

  it("keeps everything when every module is on", () => {
    const r = stripModuleGatedItemFields(base, ["todo", "ranking"]);
    expect(r.completed).toBe(true);
    expect(r.position).toBe(1024);
  });

  it("strips everything when no modules are enabled", () => {
    const r = stripModuleGatedItemFields(base, []);
    expect(r.completed).toBeUndefined();
    expect(r.position).toBeUndefined();
  });
});

// --- Item-kind content validation (§3.1) ---
//
// Items carry a `kind` and a `content` jsonb validated by the registry in
// `@workshop/shared/itemKinds`. Strict-on-write means a stale client can't
// smuggle typos into jsonb. These cases lock the contract for each kind so
// drift in the registry is caught at test time, not at write time.

import { ITEM_KINDS, validateContent } from "@workshop/shared/itemKinds";

describe("validateContent per kind", () => {
  it("accepts a TMDB-shaped movie", () => {
    expect(() =>
      validateContent("movie", {
        source: "tmdb",
        sourceId: "603692",
        posterUrl: "https://image.tmdb.org/x.jpg",
        year: 2023,
        runtimeMinutes: 169,
        overview: "the franchise continues",
      }),
    ).not.toThrow();
  });

  it("rejects an unknown field on movie (strict-on-write)", () => {
    expect(() => validateContent("movie", { unknownField: "x" })).toThrow();
  });

  it("rejects a movie source other than tmdb/manual", () => {
    expect(() => validateContent("movie", { source: "imdb" })).toThrow();
  });

  it("rejects movie year out of range", () => {
    expect(() => validateContent("movie", { year: 1500 })).toThrow();
    expect(() => validateContent("movie", { year: 2300 })).toThrow();
  });

  it("accepts the same shape for tv as movie", () => {
    expect(() =>
      validateContent("tv", { source: "tmdb", year: 2024, runtimeMinutes: 42 }),
    ).not.toThrow();
  });

  it("accepts a Google Books book", () => {
    expect(() =>
      validateContent("book", {
        source: "google_books",
        sourceId: "abc",
        authors: ["N.K. Jemisin"],
        year: 2015,
        pageCount: 512,
      }),
    ).not.toThrow();
  });

  it("rejects book with runtimeMinutes (movie-only field)", () => {
    expect(() => validateContent("book", { runtimeMinutes: 90 })).toThrow();
  });

  it("accepts a link with geo coordinates", () => {
    expect(() =>
      validateContent("link", {
        source: "link_preview",
        siteName: "Google Maps",
        image: "https://x.com/i.jpg",
        lat: 40.7,
        lng: -74,
      }),
    ).not.toThrow();
  });

  it("rejects link lat outside [-90, 90]", () => {
    expect(() => validateContent("link", { lat: 100 })).toThrow();
    expect(() => validateContent("link", { lat: -91 })).toThrow();
  });

  it("accepts the legacy thumbnailUrl on link for back-compat", () => {
    expect(() =>
      validateContent("link", { thumbnailUrl: "https://example.com/thumb.png" }),
    ).not.toThrow();
  });

  it("requires source='spotify' on spotify_album", () => {
    expect(() =>
      validateContent("spotify_album", {
        spotifyAlbumId: "abc",
        spotifyAlbumUrl: "https://open.spotify.com/album/abc",
        title: "x",
        artist: "y",
        trackCount: 10,
        detectedAt: "2026-05-01T00:00:00Z",
      }),
    ).toThrow();
    expect(() =>
      validateContent("spotify_album", {
        source: "spotify",
        spotifyAlbumId: "abc",
        spotifyAlbumUrl: "https://open.spotify.com/album/abc",
        title: "x",
        artist: "y",
        trackCount: 10,
        detectedAt: "2026-05-01T00:00:00Z",
      }),
    ).not.toThrow();
  });

  it("accepts an empty object for plain", () => {
    expect(() => validateContent("plain", {})).not.toThrow();
  });

  it("rejects any field on plain (strict empty)", () => {
    expect(() => validateContent("plain", { title: "x" })).toThrow();
  });

  it("throws an UnknownItemKindError for kinds not in the registry", () => {
    expect(() => validateContent("vinyl", {})).toThrow(/unknown item kind/);
  });

  it("ITEM_KINDS has exactly the 6 documented kinds", () => {
    expect(Object.keys(ITEM_KINDS).sort()).toEqual([
      "book",
      "link",
      "movie",
      "plain",
      "spotify_album",
      "tv",
    ]);
  });
});
