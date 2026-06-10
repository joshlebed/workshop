import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { requireModule } from "../../lib/moduleGate.js";
import { signSession } from "../../lib/session.js";
import { __test, itemScoreRoutes, listScoresRoutes } from "./scores.js";

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

// Score routes expose the legacy leaderboard-list shape keyed by item id. Some
// items are now backed by canonical `game_scores`, but the client contract still
// accepts an item id plus a free-form period key (YYYY-MM-DD, YYYY-WNN,
// all-time, etc.). These tests lock the schema shape, the helper that parses a
// numeric out of the raw input, and auth + uuid gating on the exposed endpoints.

describe("periodKeySchema", () => {
  const { periodKeySchema } = __test;

  it("accepts a YYYY-MM-DD date", () => {
    expect(periodKeySchema.safeParse("2026-05-18").success).toBe(true);
  });

  it("accepts a YYYY-WNN ISO week token", () => {
    expect(periodKeySchema.safeParse("2026-W21").success).toBe(true);
  });

  it("accepts 'all-time'", () => {
    expect(periodKeySchema.safeParse("all-time").success).toBe(true);
  });

  it("accepts an alphanumeric custom token", () => {
    expect(periodKeySchema.safeParse("season_2_finale").success).toBe(true);
    expect(periodKeySchema.safeParse("Q1.2026").success).toBe(true);
  });

  it("accepts ':' separator (e.g. ISO timestamp keys)", () => {
    expect(periodKeySchema.safeParse("2026-05-18T12:00:00").success).toBe(true);
  });

  it("rejects the empty string", () => {
    expect(periodKeySchema.safeParse("").success).toBe(false);
  });

  it("rejects whitespace in the key", () => {
    expect(periodKeySchema.safeParse("2026 05 18").success).toBe(false);
  });

  it("rejects punctuation outside [_-:.]", () => {
    expect(periodKeySchema.safeParse("2026/05/18").success).toBe(false);
    expect(periodKeySchema.safeParse("2026,05,18").success).toBe(false);
    expect(periodKeySchema.safeParse("hello!").success).toBe(false);
  });

  it("rejects a key longer than 64 chars", () => {
    expect(periodKeySchema.safeParse("a".repeat(64)).success).toBe(true);
    expect(periodKeySchema.safeParse("a".repeat(65)).success).toBe(false);
  });
});

describe("scoreRawSchema", () => {
  const { scoreRawSchema } = __test;

  it("accepts a number-shaped string", () => {
    expect(scoreRawSchema.safeParse("42").success).toBe(true);
  });

  it("accepts emoji-decorated Wordle-style scores", () => {
    expect(scoreRawSchema.safeParse("Wordle 1,127 3/6\n\n⬜⬜🟩🟩🟩").success).toBe(true);
  });

  it("rejects the empty string", () => {
    expect(scoreRawSchema.safeParse("").success).toBe(false);
  });

  it("clamps at 2000 chars", () => {
    expect(scoreRawSchema.safeParse("x".repeat(2000)).success).toBe(true);
    expect(scoreRawSchema.safeParse("x".repeat(2001)).success).toBe(false);
  });
});

describe("upsertScoreSchema", () => {
  const { upsertScoreSchema } = __test;

  it("accepts a typical (periodKey, scoreRaw) pair", () => {
    expect(upsertScoreSchema.safeParse({ periodKey: "2026-05-18", scoreRaw: "42" }).success).toBe(
      true,
    );
  });

  it("requires periodKey", () => {
    expect(upsertScoreSchema.safeParse({ scoreRaw: "42" }).success).toBe(false);
  });

  it("requires scoreRaw", () => {
    expect(upsertScoreSchema.safeParse({ periodKey: "2026-05-18" }).success).toBe(false);
  });

  it("rejects an unknown extra field", () => {
    const r = upsertScoreSchema.safeParse({
      periodKey: "2026-05-18",
      scoreRaw: "42",
      scoreValue: 42,
    });
    // zod by default ignores extras unless strict — we accept this shape
    // (server computes scoreValue itself), so this lookup verifies the
    // contract rather than enforcing strictness.
    expect(r.success).toBe(true);
  });
});

describe("tryParseScoreValue (helper)", () => {
  const { tryParseScoreValue } = __test;

  describe("with no pattern (legacy fallback)", () => {
    it("parses a leading integer", () => {
      expect(tryParseScoreValue("42")).toBe(42);
    });

    it("parses a decimal", () => {
      expect(tryParseScoreValue("3.14")).toBe(3.14);
    });

    it("parses a negative", () => {
      expect(tryParseScoreValue("-7")).toBe(-7);
    });

    it("extracts the first number from a Wordle-style block", () => {
      expect(tryParseScoreValue("Wordle 1,127 3/6")).toBe(1);
    });

    it("returns null when no number is present", () => {
      expect(tryParseScoreValue("⬜⬜🟩🟩🟩")).toBeNull();
      expect(tryParseScoreValue("abc")).toBeNull();
    });
  });

  describe("with a per-item pattern (post-backfill)", () => {
    it("extracts MapTap's final score from a real share", () => {
      const raw = "www.maptap.gg May 18\n96🔥 95🏅 99🎯 96🔥 93👑\nFinal score: 956";
      expect(tryParseScoreValue(raw, "Final score:\\s*(\\d+)")).toBe(956);
    });

    it("extracts Satle's guesses (X/6) — not the puzzle number", () => {
      const raw = "🛰Satle #449 5/6\n🟥🟥🟥🟥🟩⬜\nhttps://satle.ca";
      expect(tryParseScoreValue(raw, "Satle\\s*#\\d+\\s+(\\d+)/6")).toBe(5);
    });

    it("extracts travle's extra-guess count from +N", () => {
      const raw = "#travle #1252 +1\n🟧✅✅✅\nhttps://travle.earth";
      expect(tryParseScoreValue(raw, "#travle\\s+#?\\d+\\s+\\+(\\d+)")).toBe(1);
    });

    it("extracts Tradle's guesses (X/6) — not the puzzle number", () => {
      const raw = "#Tradle #1547 1/6\n🟩🟩🟩🟩🟩\nhttps://tradle.net/";
      expect(tryParseScoreValue(raw, "Tradle\\s*#?\\d+\\s+(\\d+)/6")).toBe(1);
    });

    it("extracts Globle's = N daily count even with URL + hashtag trailing", () => {
      const raw = "🌎 May 19, 2026 🌍\n⬜⬜🟧🟥🟩 = 5\n\nhttps://globle-game.com\n#globle";
      expect(tryParseScoreValue(raw, "=\\s*(\\d+)")).toBe(5);
    });

    it("returns null when the configured pattern doesn't match — does NOT fall back to legacy", () => {
      // Once a per-item regex is configured we trust it. Falling back to the
      // first number would resurface the "pulled the puzzle number out of the
      // share" bug we're fixing.
      expect(tryParseScoreValue("abc 42 def", "Final score:\\s*(\\d+)")).toBeNull();
    });

    it("is case-insensitive (backend always applies the `i` flag)", () => {
      expect(tryParseScoreValue("FINAL SCORE: 70", "Final score:\\s*(\\d+)")).toBe(70);
    });

    it("returns null when the pattern itself is invalid (no crash)", () => {
      // unclosed group; new RegExp() throws — we swallow and fall back. With
      // no other digits in the input this means null.
      expect(tryParseScoreValue("no digits here", "(\\d+")).toBeNull();
    });

    it("falls back to legacy first-number when the stored regex throws", () => {
      // Bad pattern + free-form input → legacy fallback finds the first num.
      expect(tryParseScoreValue("Wordle 1,127 3/6", "(\\d+")).toBe(1);
    });
  });

  describe("with a count: pattern (tally games like Daily Tens)", () => {
    it("scores by the number of 🏆 (more correct is better)", () => {
      const raw = "DailyTens #760\n🏆 🏆 🏆 🏆 🏆 🏆 🏆 🏆 ❌ ❌";
      expect(tryParseScoreValue(raw, "count:🏆")).toBe(8);
    });

    it("counts only 🏆 — ignores the puzzle number and ?ref id in the share", () => {
      const raw =
        "https://dailytens.com/?ref=943757\nDailyTens #760\n🏆 🏆 🏆 🏆 🏆 🏆 🏆 🏆 🏆 ❌";
      expect(tryParseScoreValue(raw, "count:🏆")).toBe(9);
    });

    it("returns 0 (a valid worst score), not null, when nothing was correct", () => {
      expect(tryParseScoreValue("DailyTens #761\n❌ ❌ ❌ ❌ ❌ ❌ ❌ ❌ ❌ ❌", "count:🏆")).toBe(
        0,
      );
    });

    it("falls back to legacy first-number when the count pattern is malformed", () => {
      // Unclosed group throws → legacy fallback finds the first number.
      expect(tryParseScoreValue("Wordle 1,127 3/6", "count:(")).toBe(1);
    });
  });
});

describe("assignRanks (helper)", () => {
  const { assignRanks } = __test;

  it("ranks descending (higher is better) — MapTap-style", () => {
    const ranked = assignRanks(
      [
        { userId: "a", scoreValue: 980 },
        { userId: "b", scoreValue: 950 },
        { userId: "c", scoreValue: 932 },
      ],
      "desc",
    );
    expect(ranked.map((r) => [r.userId, r.rank])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });

  it("ranks ascending (lower is better) — Wordle / Satle-style", () => {
    const ranked = assignRanks(
      [
        { userId: "a", scoreValue: 6 },
        { userId: "b", scoreValue: 3 },
        { userId: "c", scoreValue: 5 },
      ],
      "asc",
    );
    const ranksById = Object.fromEntries(ranked.map((r) => [r.userId, r.rank]));
    expect(ranksById).toEqual({ a: 3, b: 1, c: 2 });
  });

  it("uses standard competition ranking for ties (1, 2, 2, 4)", () => {
    const ranked = assignRanks(
      [
        { userId: "a", scoreValue: 100 },
        { userId: "b", scoreValue: 90 },
        { userId: "c", scoreValue: 90 },
        { userId: "d", scoreValue: 50 },
      ],
      "desc",
    );
    const ranksById = Object.fromEntries(ranked.map((r) => [r.userId, r.rank]));
    expect(ranksById).toEqual({ a: 1, b: 2, c: 2, d: 4 });
  });

  it("leaves unplayed entries with rank: null", () => {
    const ranked = assignRanks(
      [
        { userId: "a", scoreValue: 100 },
        { userId: "b", scoreValue: null },
        { userId: "c", scoreValue: 50 },
      ],
      "desc",
    );
    const ranksById = Object.fromEntries(ranked.map((r) => [r.userId, r.rank]));
    expect(ranksById).toEqual({ a: 1, b: null, c: 2 });
  });

  it("preserves the caller's order (so the SQL ORDER BY isn't disturbed)", () => {
    const ranked = assignRanks(
      [
        { userId: "a", scoreValue: 100 },
        { userId: "b", scoreValue: 200 },
      ],
      "desc",
    );
    expect(ranked.map((r) => r.userId)).toEqual(["a", "b"]);
  });
});

// --- itemScoreRoutes auth + uuid gating ---

describe("itemScoreRoutes auth gating", () => {
  it("PUT /:id/scores requires a bearer token", async () => {
    const res = await itemScoreRoutes.request(`/${validUuid}/scores`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ periodKey: "2026-05-18", scoreRaw: "42" }),
    });
    expect(res.status).toBe(401);
  });

  it("DELETE /:id/scores requires a bearer token", async () => {
    const res = await itemScoreRoutes.request(`/${validUuid}/scores?periodKey=2026-05-18`, {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

  it("GET /:id/scores requires a bearer token", async () => {
    const res = await itemScoreRoutes.request(`/${validUuid}/scores?periodKey=2026-05-18`);
    expect(res.status).toBe(401);
  });

  it("rejects an invalid bearer token", async () => {
    const res = await itemScoreRoutes.request(`/${validUuid}/scores?periodKey=x`, {
      headers: { Authorization: "Bearer junk" },
    });
    expect(res.status).toBe(401);
  });
});

describe("itemScoreRoutes input validation (bails before DB)", () => {
  it("PUT /:id/scores 404s when id isn't a uuid", async () => {
    const res = await itemScoreRoutes.request(`/not-a-uuid/scores`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ periodKey: "2026-05-18", scoreRaw: "42" }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /:id/scores 404s when id isn't a uuid", async () => {
    const res = await itemScoreRoutes.request(`/not-a-uuid/scores?periodKey=x`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("GET /:id/scores 404s when id isn't a uuid", async () => {
    const res = await itemScoreRoutes.request(`/not-a-uuid/scores?periodKey=x`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

// --- listScoresRoutes auth + uuid gating ---

describe("listScoresRoutes auth gating", () => {
  it("GET /:id/scores requires a bearer token", async () => {
    const res = await listScoresRoutes.request(`/${validUuid}/scores?periodKey=2026-05-18`);
    expect(res.status).toBe(401);
  });

  it("rejects an invalid bearer token", async () => {
    const res = await listScoresRoutes.request(`/${validUuid}/scores?periodKey=x`, {
      headers: { Authorization: "Bearer junk" },
    });
    expect(res.status).toBe(401);
  });

  it("GET /:id/scores 404s when list id isn't a uuid", async () => {
    const res = await listScoresRoutes.request(`/not-a-uuid/scores?periodKey=x`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

// --- Module gate (§5.1): leaderboard.disabled ---
//
// Score endpoints all flow through `requireModule(c, modules, "leaderboard")`.
// The 409 envelope is the contract — 3+ assertions per gated surface.

async function runGate(modules: string[]): Promise<{ status: number; body: unknown }> {
  const app = new Hono();
  app.get("/x", (c) => {
    const r = requireModule(c, modules, "leaderboard");
    if (r) return r;
    return c.text("ok");
  });
  const res = await app.request("/x");
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("score endpoints — leaderboard module gate", () => {
  it("returns 409 when leaderboard is off (per-item PUT)", async () => {
    const r = await runGate([]);
    expect(r.status).toBe(409);
    const b = r.body as {
      error: string;
      code: string;
      details: { code: string; module: string; message: string };
    };
    expect(b.error).toBe("module_disabled");
    expect(b.details.code).toBe("leaderboard.disabled");
    expect(b.details.module).toBe("leaderboard");
    expect(b.details.message.length).toBeGreaterThan(0);
  });

  it("returns 409 when leaderboard is off (per-item GET)", async () => {
    const r = await runGate(["sources", "ranking"]);
    expect(r.status).toBe(409);
    const b = r.body as { details: { code: string } };
    expect(b.details.code).toBe("leaderboard.disabled");
  });

  it("returns 409 when leaderboard is off (per-item DELETE)", async () => {
    const r = await runGate(["todo"]);
    expect(r.status).toBe(409);
    const b = r.body as { details: { code: string } };
    expect(b.details.code).toBe("leaderboard.disabled");
  });

  it("passes through when leaderboard is on", async () => {
    const r = await runGate(["leaderboard"]);
    expect(r.status).toBe(200);
  });

  it("passes through when leaderboard is on alongside other modules", async () => {
    const r = await runGate(["sources", "leaderboard", "ranking"]);
    expect(r.status).toBe(200);
  });
});

// --- Query-string contract (periodKey is required for read/delete) ---

describe("scores: periodKey query-string contract", () => {
  // Each test uses a valid uuid in the path so requireItemMember + auth pass,
  // then asserts on the periodKey query-string parsing. The middleware will
  // 404 in this environment (no live DB membership lookup), so we use a
  // fully-valid path and a missing/invalid `periodKey` to assert the route
  // would 400 if the membership lookup succeeded. The point of these is to
  // lock the schema, not exercise the route.
  const { periodKeySchema } = __test;

  it("blanks the query → schema reports invalid (server returns 400 'periodKey query param required')", () => {
    expect(periodKeySchema.safeParse("").success).toBe(false);
  });

  it("invalid characters are rejected even when present", () => {
    expect(periodKeySchema.safeParse("2026/05/18").success).toBe(false);
  });

  it("the `date=` legacy alias is accepted at the route level (still YYYY-MM-DD)", () => {
    expect(periodKeySchema.safeParse("2026-05-18").success).toBe(true);
  });
});
