import { beforeAll, describe, expect, it } from "vitest";
import { signSession } from "../../lib/session.js";
import { __test, activityRoutes, markReadSchema } from "./activity.js";

beforeAll(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
});

// `z.string().uuid()` (zod 4) requires a real version digit (1–8) — the
// all-zero UUID convention used elsewhere in tests fails parse on the
// `markReadSchema.listIds` field. Use a v4 shape here instead.
const validUuid = "00000000-0000-4000-8000-000000000001";

function authHeaders(): { Authorization: string; "Content-Type": string } {
  return {
    Authorization: `Bearer ${signSession(validUuid)}`,
    "Content-Type": "application/json",
  };
}

describe("activity cursor encoding", () => {
  const { encodeCursor, decodeCursor } = __test;

  it("round-trips a (createdAt, id) pair", () => {
    const ts = new Date("2026-04-25T12:34:56.789Z");
    const id = "11111111-2222-3333-4444-555555555555";
    const enc = encodeCursor(ts, id);
    const dec = decodeCursor(enc);
    expect(dec).not.toBeNull();
    expect(dec?.createdAt.getTime()).toBe(ts.getTime());
    expect(dec?.id).toBe(id);
  });

  it("returns a base64url string (no padding, no +/)", () => {
    const enc = encodeCursor(new Date("2026-04-25T00:00:00Z"), validUuid);
    expect(enc).not.toMatch(/[+/=]/);
  });

  it("decodes undefined to null", () => {
    expect(decodeCursor(undefined)).toBeNull();
  });

  it("decodes garbage to null", () => {
    expect(decodeCursor("not-base64!!!")).toBeNull();
    expect(decodeCursor("aaa")).toBeNull(); // no separator
  });

  it("rejects an over-long cursor (DoS guard)", () => {
    expect(decodeCursor("a".repeat(300))).toBeNull();
  });

  it("rejects a non-UUID id segment", () => {
    const enc = Buffer.from(`2026-04-25T00:00:00.000Z|not-a-uuid`, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeCursor(enc)).toBeNull();
  });

  it("rejects an unparseable timestamp", () => {
    const enc = Buffer.from(`not-a-date|${validUuid}`, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeCursor(enc)).toBeNull();
  });
});

describe("markReadSchema", () => {
  it("accepts undefined (mark-all)", () => {
    expect(markReadSchema.safeParse(undefined).success).toBe(true);
  });

  it("accepts an empty object", () => {
    expect(markReadSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a single-uuid listIds array", () => {
    expect(markReadSchema.safeParse({ listIds: [validUuid] }).success).toBe(true);
  });

  it("accepts an empty listIds array (no-op)", () => {
    expect(markReadSchema.safeParse({ listIds: [] }).success).toBe(true);
  });

  it("rejects a non-uuid in listIds", () => {
    expect(markReadSchema.safeParse({ listIds: ["not-a-uuid"] }).success).toBe(false);
  });

  it("rejects more than 500 listIds", () => {
    const ids = Array(501).fill(validUuid);
    expect(markReadSchema.safeParse({ listIds: ids }).success).toBe(false);
  });
});

// These suites exercise the route layer directly and only validate
// behavior that doesn't reach the DB — auth gating and JSON parsing.
// The DB path (membership-scoped feed, cursor pagination, upsert) is
// covered by the dev server / Playwright in 3b-2. Same convention as
// `lists.test.ts` / `invites.test.ts`.
describe("activityRoutes auth gating", () => {
  it("GET / requires a bearer token", async () => {
    const res = await activityRoutes.request("/", { method: "GET" });
    expect(res.status).toBe(401);
  });

  it("POST /read requires a bearer token", async () => {
    const res = await activityRoutes.request("/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid bearer token", async () => {
    const res = await activityRoutes.request("/", {
      method: "GET",
      headers: { Authorization: "Bearer not-a-real-token" },
    });
    expect(res.status).toBe(401);
  });
});

describe("activityRoutes input validation", () => {
  it("GET / 400s on a non-numeric limit", async () => {
    const res = await activityRoutes.request("/?limit=abc", {
      method: "GET",
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "VALIDATION" });
  });

  it("GET / 400s on a limit above 100", async () => {
    const res = await activityRoutes.request("/?limit=200", {
      method: "GET",
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
  });

  it("GET / 400s on a limit below 1", async () => {
    const res = await activityRoutes.request("/?limit=0", {
      method: "GET",
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
  });

  it("POST /read 400s on non-JSON body", async () => {
    const res = await activityRoutes.request("/read", {
      method: "POST",
      headers: authHeaders(),
      body: "not json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "VALIDATION" });
  });

  it("POST /read 400s on a non-uuid in listIds", async () => {
    const res = await activityRoutes.request("/read", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ listIds: ["not-a-uuid"] }),
    });
    expect(res.status).toBe(400);
  });
});
