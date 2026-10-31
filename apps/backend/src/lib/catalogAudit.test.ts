// PGlite integration test for the catalog ops audit: candidates vs listed
// games, content flag, parser health, and the markdown the automation pastes.

import { PGlite } from "@electric-sql/pglite";
import { OFFICIAL_CATALOG_EXTRAS } from "@workshop/shared/gameRegistry";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";

let testDb: ReturnType<typeof drizzle>;
vi.mock("../db/client.js", () => ({ getDb: () => testDb }));

import { renderCatalogAuditMarkdown, runCatalogAudit, suggestCategory } from "./catalogAudit.js";

const u1 = "00000000-0000-4000-8000-0000000000f1";
const u2 = "00000000-0000-4000-8000-0000000000f2";

async function exec(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  return (await client.query<Record<string, string>>(query, params)).rows;
}

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  testDb = drizzle(new PGlite());
  await migrate(testDb, { migrationsFolder: "./drizzle" });

  await exec(
    `INSERT INTO users (id, email, display_name) VALUES ($1, 'a@x.com', 'A'), ($2, 'b@x.com', 'B')`,
    [u1, u2],
  );
  // Two unlisted games with players: a clean one (2 players) and one whose
  // title trips the content filter (1 player). A third unlisted game nobody
  // added must not be a candidate.
  const ins = async (url: string, title: string) =>
    (
      await exec(
        `INSERT INTO games (normalized_url, url, title) VALUES ($1, $2, $3) RETURNING id`,
        [url, `https://${url}`, title],
      )
    )[0]?.id;
  const squaredle = await ins("squaredle.app", "Squaredle");
  const nasty = await ins("nasty.example", "Fag Daily");
  await ins("lonely.example", "Lonely");
  await exec(`INSERT INTO user_games (user_id, game_id) VALUES ($1, $3), ($2, $3), ($1, $4)`, [
    u1,
    u2,
    squaredle,
    nasty,
  ]);
  // Wordle (listed, has seeded parser): one player, 6 recent scores, 3 unread.
  const wordle = (await exec(`SELECT id FROM games WHERE game_key = 'wordle'`))[0]?.id;
  await exec(`INSERT INTO user_games (user_id, game_id) VALUES ($1, $2)`, [u1, wordle]);
  for (let i = 0; i < 6; i++) {
    await exec(
      `INSERT INTO game_scores (game_id, user_id, period_key, score_raw, parse_status)
       VALUES ($1, $2, $3, 'Wordle 1 3/6', $4)`,
      [
        wordle,
        i % 2 ? u1 : u2,
        `2026-10-${String(10 + i).padStart(2, "0")}`,
        i < 3 ? "failed" : "score",
      ],
    );
  }
});

describe("suggestCategory", () => {
  it("keyword-guesses a game type and falls back to other", () => {
    expect(suggestCategory("Squaredle", "https://squaredle.app")).toBe("words");
    expect(suggestCategory("Countryle", "https://countryle.com")).toBe("geography");
    expect(suggestCategory("Heardle", "https://heardle.app")).toBe("music-movies");
    expect(suggestCategory("Zzyzx", "https://zzyzx.example")).toBe("other");
  });
});

describe("runCatalogAudit", () => {
  it("lists unlisted games with players as candidates, flags content, and skips the unplayed", async () => {
    const report = await runCatalogAudit(new Date("2026-10-20T00:00:00Z"));
    expect(
      report.candidates.map((c) => [c.title, c.playerCount, c.suggestedCategory, c.flags]),
    ).toEqual([
      ["Squaredle", 2, "words", ["no-parser"]],
      ["Fag Daily", 1, "other", ["objectionable-title", "no-parser", "single-player"]],
    ]);
    expect(report.totals.candidates).toBe(2);
  });

  it("flags a listed game whose recent scores read badly, and nothing healthy", async () => {
    const report = await runCatalogAudit(new Date("2026-10-20T00:00:00Z"));
    const wordle = report.unhealthy.find((h) => h.gameKey === "wordle");
    expect(wordle).toBeDefined();
    expect(wordle?.issues).toContain("3/6 scores unread in the last 30 days");
    expect(wordle?.hasParser).toBe(true);
    // Every seeded registry game has a parser and no conflict; the only other
    // thing the audit can hold against them is a missing formatter.
    for (const h of report.unhealthy.filter((h) => h.gameKey !== "wordle")) {
      expect(h.hasParser).toBe(true);
      expect(h.issues).toEqual(["no formatter: rows show raw share text"]);
    }
    // The fixture DB has no row for any reviewed extra, so every extra reads
    // as stale here — and none of them may be counted as listed above.
    expect(report.staleExtras.map((e) => e.normalizedUrl)).toEqual(
      OFFICIAL_CATALOG_EXTRAS.map((e) => e.normalizedUrl),
    );
  });

  it("renders markdown with proposed extras that exclude the flagged title", async () => {
    const md = renderCatalogAuditMarkdown(await runCatalogAudit(new Date("2026-10-20T00:00:00Z")));
    expect(md).toContain(
      "| Squaredle | https://squaredle.app | 2 | 0 | no | Word games | no-parser |",
    );
    expect(md).toContain(
      '{ normalizedUrl: "squaredle.app", title: "Squaredle", category: "words" },',
    );
    expect(md).not.toContain('normalizedUrl: "nasty.example"');
    expect(md).toContain("**Wordle**");
  });
});
