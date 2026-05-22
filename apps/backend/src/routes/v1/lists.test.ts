import { beforeAll, describe, expect, it } from "vitest";
import { signSession } from "../../lib/session.js";
import { __test, listRoutes } from "./lists.js";

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

// Route-layer tests for `/v1/lists`. Schema coverage:
//   - create accepts the new `{ name, emoji, color, itemKind, modules, sources? }`
//   - PATCH accepts module/itemKind changes + `acknowledgedWarnings` echo
//   - config-preview accepts both `modules` and `itemKind`
//   - duplicate accepts the `preserveCompletion` / `copySources` matrix
// DB-driven behavior (the warning-emit branch, the tightening guard) is
// covered by the Playwright suite — these tests lock the wire shape so the
// server contract doesn't silently regress.

describe("createListSchema", () => {
  const { createListSchema } = __test;

  function base(): Record<string, unknown> {
    return {
      name: "Movie Watchlist",
      emoji: "🎬",
      color: "sunset",
      modules: ["todo", "ranking"],
    };
  }

  it("accepts the canonical Movie Watchlist preset", () => {
    expect(createListSchema.safeParse({ ...base(), itemKind: "movie" }).success).toBe(true);
  });

  it("accepts a Blank List (itemKind null)", () => {
    expect(
      createListSchema.safeParse({
        ...base(),
        itemKind: null,
        modules: ["ranking"],
      }).success,
    ).toBe(true);
  });

  it("accepts itemKind omitted (legacy clients)", () => {
    const r = createListSchema.safeParse(base());
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.itemKind).toBeUndefined();
  });

  it("trims name whitespace", () => {
    const r = createListSchema.safeParse({ ...base(), name: "  Trimmed  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Trimmed");
  });

  it("rejects empty name", () => {
    expect(createListSchema.safeParse({ ...base(), name: "   " }).success).toBe(false);
  });

  it("rejects newline in name / emoji", () => {
    expect(createListSchema.safeParse({ ...base(), name: "a\nb" }).success).toBe(false);
    expect(createListSchema.safeParse({ ...base(), emoji: "a\nb" }).success).toBe(false);
  });

  it("rejects a name longer than 100 chars after trim", () => {
    expect(createListSchema.safeParse({ ...base(), name: "a".repeat(101) }).success).toBe(false);
    expect(createListSchema.safeParse({ ...base(), name: "a".repeat(100) }).success).toBe(true);
  });

  it("rejects an unknown color", () => {
    expect(createListSchema.safeParse({ ...base(), color: "puce" }).success).toBe(false);
  });

  it("rejects an unknown module", () => {
    expect(createListSchema.safeParse({ ...base(), modules: ["todo", "made_up"] }).success).toBe(
      false,
    );
  });

  it("rejects an unknown itemKind", () => {
    expect(createListSchema.safeParse({ ...base(), itemKind: "vinyl" }).success).toBe(false);
  });

  it("normalizes (dedupes + canonical-orders) the modules array", () => {
    const r = createListSchema.safeParse({
      ...base(),
      modules: ["ranking", "sources", "ranking", "todo"],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.modules).toEqual(["todo", "ranking", "sources"]);
  });

  it("accepts an attached source on create (album-shelf flow)", () => {
    const r = createListSchema.safeParse({
      ...base(),
      itemKind: "spotify_album",
      modules: ["ranking", "sources"],
      sources: [
        {
          kind: "spotify_playlist",
          config: {
            spotifyPlaylistUrl: "https://open.spotify.com/playlist/abc",
            spotifyPlaylistId: "abc",
          },
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown source kind", () => {
    expect(
      createListSchema.safeParse({
        ...base(),
        sources: [{ kind: "rss_feed", config: {} }],
      }).success,
    ).toBe(false);
  });

  it("caps the sources array at 4 entries", () => {
    const five = Array(5)
      .fill(0)
      .map(() => ({ kind: "spotify_playlist", config: {} }));
    expect(createListSchema.safeParse({ ...base(), sources: five }).success).toBe(false);
  });
});

describe("updateListSchema", () => {
  const { updateListSchema } = __test;

  it("rejects an empty patch", () => {
    expect(updateListSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a single-field patch (name only)", () => {
    expect(updateListSchema.safeParse({ name: "renamed" }).success).toBe(true);
  });

  it("accepts a modules-only patch", () => {
    expect(updateListSchema.safeParse({ modules: ["todo"] }).success).toBe(true);
  });

  it("accepts setting itemKind to null (loosen to unconstrained)", () => {
    const r = updateListSchema.safeParse({ itemKind: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.itemKind).toBeNull();
  });

  it("accepts tightening itemKind (server-side guard runs separately)", () => {
    expect(updateListSchema.safeParse({ itemKind: "movie" }).success).toBe(true);
  });

  it("accepts clearing description/coverPhotoUrl with null", () => {
    expect(updateListSchema.safeParse({ description: null }).success).toBe(true);
    expect(updateListSchema.safeParse({ coverPhotoUrl: null }).success).toBe(true);
  });

  it("accepts an acknowledgedWarnings echo", () => {
    const r = updateListSchema.safeParse({
      modules: ["ranking"],
      acknowledgedWarnings: ["todo.hide_completed"],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.acknowledgedWarnings).toEqual(["todo.hide_completed"]);
    }
  });

  it("normalizes a modules patch through normalizeModules", () => {
    const r = updateListSchema.safeParse({
      modules: ["sources", "todo", "todo"],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.modules).toEqual(["todo", "sources"]);
  });

  it("rejects an unknown color in a patch", () => {
    expect(updateListSchema.safeParse({ color: "puce" }).success).toBe(false);
  });
});

describe("configPreviewSchema", () => {
  const { configPreviewSchema } = __test;

  it("accepts an empty body (no proposed change)", () => {
    expect(configPreviewSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a modules-only preview", () => {
    expect(configPreviewSchema.safeParse({ modules: ["todo"] }).success).toBe(true);
  });

  it("accepts a tightening itemKind preview", () => {
    expect(configPreviewSchema.safeParse({ itemKind: "movie" }).success).toBe(true);
  });

  it("accepts a loosening itemKind preview (null)", () => {
    expect(configPreviewSchema.safeParse({ itemKind: null }).success).toBe(true);
  });

  it("rejects an unknown itemKind", () => {
    expect(configPreviewSchema.safeParse({ itemKind: "vinyl" }).success).toBe(false);
  });

  it("rejects an unknown module", () => {
    expect(configPreviewSchema.safeParse({ modules: ["made_up"] }).success).toBe(false);
  });
});

describe("duplicateListSchema", () => {
  const { duplicateListSchema } = __test;

  it("accepts an empty body (use source defaults)", () => {
    expect(duplicateListSchema.safeParse({}).success).toBe(true);
  });

  it("accepts the full preserveCompletion x copySources matrix", () => {
    for (const preserveCompletion of [true, false]) {
      for (const copySources of [true, false]) {
        const r = duplicateListSchema.safeParse({
          preserveCompletion,
          copySources,
        });
        expect(r.success).toBe(true);
        if (r.success) {
          expect(r.data.preserveCompletion).toBe(preserveCompletion);
          expect(r.data.copySources).toBe(copySources);
        }
      }
    }
  });

  it("accepts a rename + module override", () => {
    const r = duplicateListSchema.safeParse({
      name: "Best album for movie night?",
      modules: ["todo"],
      preserveCompletion: false,
    });
    expect(r.success).toBe(true);
  });

  it("accepts emoji/color/description overrides", () => {
    const r = duplicateListSchema.safeParse({
      emoji: "🗳️",
      color: "grape",
      description: "A fresh poll seeded from another list.",
    });
    expect(r.success).toBe(true);
  });

  it("accepts setting itemKind to null", () => {
    const r = duplicateListSchema.safeParse({ itemKind: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.itemKind).toBeNull();
  });

  it("rejects an unknown itemKind", () => {
    expect(duplicateListSchema.safeParse({ itemKind: "vinyl" }).success).toBe(false);
  });

  it("rejects a non-boolean preserveCompletion", () => {
    expect(duplicateListSchema.safeParse({ preserveCompletion: "yes" }).success).toBe(false);
  });

  it("rejects a non-boolean copySources", () => {
    expect(duplicateListSchema.safeParse({ copySources: 1 }).success).toBe(false);
  });
});

describe("createSourceSchema", () => {
  const { createSourceSchema } = __test;

  it("accepts a Spotify playlist config", () => {
    expect(
      createSourceSchema.safeParse({
        kind: "spotify_playlist",
        config: {
          spotifyPlaylistUrl: "https://open.spotify.com/playlist/abc",
          spotifyPlaylistId: "abc",
        },
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown source kind", () => {
    expect(createSourceSchema.safeParse({ kind: "rss_feed", config: {} }).success).toBe(false);
  });

  it("accepts an empty config (validated downstream by previewSpotifyPlaylist)", () => {
    expect(createSourceSchema.safeParse({ kind: "spotify_playlist", config: {} }).success).toBe(
      true,
    );
  });
});

// --- Auth + uuid gating ---

describe("listRoutes auth gating", () => {
  it("GET / requires a bearer token", async () => {
    const res = await listRoutes.request("/");
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

  it("GET /:id requires a bearer token", async () => {
    const res = await listRoutes.request(`/${validUuid}`);
    expect(res.status).toBe(401);
  });

  it("PATCH /:id requires a bearer token", async () => {
    const res = await listRoutes.request(`/${validUuid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /:id/config-preview requires a bearer token", async () => {
    const res = await listRoutes.request(`/${validUuid}/config-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("POST /:id/duplicate requires a bearer token", async () => {
    const res = await listRoutes.request(`/${validUuid}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("DELETE /:id requires a bearer token", async () => {
    const res = await listRoutes.request(`/${validUuid}`, { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid bearer token", async () => {
    const res = await listRoutes.request("/", {
      headers: { Authorization: "Bearer not-a-real-token" },
    });
    expect(res.status).toBe(401);
  });
});

describe("listRoutes input validation (bails before DB)", () => {
  it("GET /:id 404s when id isn't a uuid", async () => {
    const res = await listRoutes.request("/not-a-uuid", { headers: authHeaders() });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("PATCH /:id 404s when id isn't a uuid", async () => {
    const res = await listRoutes.request("/not-a-uuid", {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ name: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /:id 404s when id isn't a uuid", async () => {
    const res = await listRoutes.request("/not-a-uuid", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("POST /:id/config-preview 404s when id isn't a uuid", async () => {
    const res = await listRoutes.request("/not-a-uuid/config-preview", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it("POST /:id/duplicate 404s when id isn't a uuid", async () => {
    const res = await listRoutes.request("/not-a-uuid/duplicate", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it("POST / 400s on non-JSON body", async () => {
    const res = await listRoutes.request("/", {
      method: "POST",
      headers: authHeaders(),
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });

  it("POST / 400s on missing required fields", async () => {
    const res = await listRoutes.request("/", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "x" }), // missing emoji/color/modules
    });
    expect(res.status).toBe(400);
  });
});

// --- itemKind tightening guard surface ---
//
// The guard at the route level returns 409 `kind_constraint_violation` when
// tightening `itemKind` would orphan items of a different kind. The DB
// branch is covered by Playwright; the schema layer just needs to admit the
// PATCH shape so the guard can run.
describe("itemKind tightening (PATCH shape)", () => {
  const { updateListSchema } = __test;

  it("accepts the tightening patch shape (null → movie)", () => {
    const r = updateListSchema.safeParse({ itemKind: "movie" });
    expect(r.success).toBe(true);
  });

  it("accepts loosening (movie → null) — always allowed by §3.2", () => {
    const r = updateListSchema.safeParse({ itemKind: null });
    expect(r.success).toBe(true);
  });

  it("accepts a no-op itemKind in the patch (idempotent)", () => {
    const r = updateListSchema.safeParse({ itemKind: "movie" });
    expect(r.success).toBe(true);
  });
});
