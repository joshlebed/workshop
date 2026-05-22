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

// `POST /v1/lists/:id/duplicate` is the only endpoint that lets a member
// fork a list into a brand-new one they own. Two booleans drive the deep-
// copy semantics:
//   - `preserveCompletion`: when true, copy items with their `completed*`
//     fields intact. When false (the default), every item resets to
//     incomplete. The toggle exists because most duplications either start a
//     fresh attempt (album-shelf → poll) or restart a checklist.
//   - `copySources`: when true, clone the parent's `list_sources` rows with
//     `last_synced_at` reset. The duplicate is created in an un-synced
//     state — the user triggers a refresh themselves if they want a fresh
//     pull (spec §5 "Duplicate").
//
// Schema tests lock the wire shape for the full 2x2 matrix and the
// auxiliary metadata overrides. DB-driven copy correctness is verified by
// Playwright; these cases guard the contract.

describe("duplicateListSchema — preserveCompletion x copySources matrix", () => {
  const { duplicateListSchema } = __test;

  // The full 2x2 matrix, plus the omit-both default (no body).
  const matrix: Array<{
    preserveCompletion: boolean | undefined;
    copySources: boolean | undefined;
  }> = [
    { preserveCompletion: undefined, copySources: undefined },
    { preserveCompletion: true, copySources: undefined },
    { preserveCompletion: false, copySources: undefined },
    { preserveCompletion: undefined, copySources: true },
    { preserveCompletion: undefined, copySources: false },
    { preserveCompletion: true, copySources: true },
    { preserveCompletion: true, copySources: false },
    { preserveCompletion: false, copySources: true },
    { preserveCompletion: false, copySources: false },
  ];

  for (const { preserveCompletion, copySources } of matrix) {
    const label = `preserveCompletion=${preserveCompletion ?? "omit"} copySources=${copySources ?? "omit"}`;
    it(`accepts ${label}`, () => {
      const body: Record<string, unknown> = {};
      if (preserveCompletion !== undefined) body.preserveCompletion = preserveCompletion;
      if (copySources !== undefined) body.copySources = copySources;
      const r = duplicateListSchema.safeParse(body);
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.preserveCompletion).toBe(preserveCompletion);
        expect(r.data.copySources).toBe(copySources);
      }
    });
  }

  it("defaults to undefined for both fields when omitted (server applies false)", () => {
    const r = duplicateListSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.preserveCompletion).toBeUndefined();
      expect(r.data.copySources).toBeUndefined();
    }
  });

  it("rejects preserveCompletion = string", () => {
    expect(duplicateListSchema.safeParse({ preserveCompletion: "yes" }).success).toBe(false);
  });

  it("rejects preserveCompletion = number", () => {
    expect(duplicateListSchema.safeParse({ preserveCompletion: 1 }).success).toBe(false);
  });

  it("rejects copySources = string", () => {
    expect(duplicateListSchema.safeParse({ copySources: "yes" }).success).toBe(false);
  });

  it("rejects copySources = null (must be boolean or omitted)", () => {
    expect(duplicateListSchema.safeParse({ copySources: null }).success).toBe(false);
  });
});

describe("duplicateListSchema — metadata overrides", () => {
  const { duplicateListSchema } = __test;

  it("accepts a name override", () => {
    const r = duplicateListSchema.safeParse({ name: "Best album for movie night?" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Best album for movie night?");
  });

  it("trims the override name", () => {
    const r = duplicateListSchema.safeParse({ name: "  Trimmed  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Trimmed");
  });

  it("rejects an empty name override", () => {
    expect(duplicateListSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("accepts an emoji override", () => {
    expect(duplicateListSchema.safeParse({ emoji: "🗳️" }).success).toBe(true);
  });

  it("accepts a color override", () => {
    expect(duplicateListSchema.safeParse({ color: "grape" }).success).toBe(true);
  });

  it("rejects an unknown color override", () => {
    expect(duplicateListSchema.safeParse({ color: "puce" }).success).toBe(false);
  });

  it("accepts a description override", () => {
    const r = duplicateListSchema.safeParse({ description: "A poll from a duped shelf." });
    expect(r.success).toBe(true);
  });
});

describe("duplicateListSchema — modules + itemKind overrides", () => {
  const { duplicateListSchema } = __test;

  it("accepts a modules override", () => {
    const r = duplicateListSchema.safeParse({ modules: ["todo"] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.modules).toEqual(["todo"]);
  });

  it("normalizes the modules override", () => {
    const r = duplicateListSchema.safeParse({
      modules: ["sources", "ranking", "ranking", "todo"],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.modules).toEqual(["todo", "ranking", "sources"]);
  });

  it("rejects an unknown module in the override", () => {
    expect(duplicateListSchema.safeParse({ modules: ["todo", "made_up"] }).success).toBe(false);
  });

  it("accepts itemKind=null in the override (loosen to unconstrained)", () => {
    const r = duplicateListSchema.safeParse({ itemKind: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.itemKind).toBeNull();
  });

  it("accepts itemKind from the registry in the override", () => {
    const r = duplicateListSchema.safeParse({ itemKind: "movie" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.itemKind).toBe("movie");
  });

  it("rejects an unknown itemKind in the override", () => {
    expect(duplicateListSchema.safeParse({ itemKind: "vinyl" }).success).toBe(false);
  });
});

describe("duplicateListSchema — combined overrides", () => {
  const { duplicateListSchema } = __test;

  it("accepts a full metadata + modules override duplicate body", () => {
    const r = duplicateListSchema.safeParse({
      name: "Best album for movie night?",
      emoji: "🗳️",
      color: "grape",
      modules: ["todo"],
      itemKind: null,
      preserveCompletion: false,
      copySources: false,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.modules).toEqual(["todo"]);
      expect(r.data.itemKind).toBeNull();
      expect(r.data.preserveCompletion).toBe(false);
      expect(r.data.copySources).toBe(false);
    }
  });

  it("accepts a 'preserve everything' duplicate (carry completion + sources)", () => {
    const r = duplicateListSchema.safeParse({
      preserveCompletion: true,
      copySources: true,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a duplicate that strips modules entirely (empty array)", () => {
    const r = duplicateListSchema.safeParse({ modules: [] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.modules).toEqual([]);
  });
});

// --- Auth + uuid gating on the duplicate endpoint ---

describe("POST /v1/lists/:id/duplicate auth gating", () => {
  it("requires a bearer token", async () => {
    const res = await listRoutes.request(`/${validUuid}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid bearer token", async () => {
    const res = await listRoutes.request(`/${validUuid}/duplicate`, {
      method: "POST",
      headers: { Authorization: "Bearer junk", "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("404s when list id isn't a uuid", async () => {
    const res = await listRoutes.request("/not-a-uuid/duplicate", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  // Body-parse / itemKind-validation behavior on requests past auth is
  // covered by the schema tests above. We don't drive the route past the
  // middleware here because the rate-limit DB call short-circuits to a 500
  // in this environment without a live Postgres connection.
});

// --- A small note on the preserveCompletion semantics in the route layer ---
//
// `POST /v1/lists/:id/duplicate` materializes the toggle by reading the
// source item rows and emitting INSERT rows. When `preserveCompletion=true`,
// the new rows carry the source's `completed` / `completedAt` / `completedBy`.
// When false (or omitted), those reset. The matrix tests above lock the
// wire shape; this section documents the runtime behavior the schema enables.
describe("preserveCompletion semantics (documentation)", () => {
  it("the default (omit) means false — reset completion state", () => {
    const { duplicateListSchema } = __test;
    const r = duplicateListSchema.safeParse({});
    expect(r.success).toBe(true);
    // Server: `parsed.data.preserveCompletion ?? false` resolves to false.
    if (r.success) expect(r.data.preserveCompletion).toBeUndefined();
  });

  it("explicitly false matches the default", () => {
    const { duplicateListSchema } = __test;
    const r = duplicateListSchema.safeParse({ preserveCompletion: false });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.preserveCompletion).toBe(false);
  });

  it("explicitly true preserves completion", () => {
    const { duplicateListSchema } = __test;
    const r = duplicateListSchema.safeParse({ preserveCompletion: true });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.preserveCompletion).toBe(true);
  });
});

describe("copySources semantics (documentation)", () => {
  it("the default (omit) means false — drop sources in the duplicate", () => {
    const { duplicateListSchema } = __test;
    const r = duplicateListSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.copySources).toBeUndefined();
  });

  it("explicitly false matches the default", () => {
    const { duplicateListSchema } = __test;
    const r = duplicateListSchema.safeParse({ copySources: false });
    expect(r.success).toBe(true);
  });

  it("explicitly true clones the source rows (last_synced_at reset)", () => {
    const { duplicateListSchema } = __test;
    const r = duplicateListSchema.safeParse({ copySources: true });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.copySources).toBe(true);
  });
});
