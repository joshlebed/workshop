// Opt-in live run of teach v2 against the real OpenAI API — skipped unless
// TEACH_LIVE=1 (never in CI). Teaches five games end to end through the real
// routes, on PGlite with the real sandbox: preview → candidates (step 1) →
// post with the pick → teach (step 2 + gates) → post another day's share and
// check what the taught parser reads.
//
//   cd apps/backend && set -a && . ./.env && set +a && \
//     TEACH_LIVE=1 pnpm exec vitest run src/routes/v1/gameTeach.live.test.ts
//
// Prints one row per game: step latencies, tokens, gates, and the read-back.

import { PGlite } from "@electric-sql/pglite";
import type {
  PreviewGameScoreResponse,
  ScoreCandidatesResponse,
  TeachParserResponse,
  UpsertGameScoreResponse,
} from "@workshop/shared/games";
import { shiftPeriodKey } from "@workshop/shared/games";
import { fixtureFeature, SCORE_SHAPE_FIXTURES } from "@workshop/shared/scoreShapeFixtures";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../../lib/config.js";
import { signSession } from "../../lib/session.js";

const LIVE = process.env.TEACH_LIVE === "1" && Boolean(process.env.OPENAI_API_KEY);

let testDb: ReturnType<typeof drizzle>;
vi.mock("../../db/client.js", () => ({ getDb: () => testDb }));
vi.mock("./link-preview.js", () => ({
  resolveLinkPreview: () => Promise.reject(new Error("network disabled in tests")),
}));

import { gameRoutes } from "./games.js";

// A Games beta account, so teach is on without touching the flag.
const josh = "b9a84203-b2c6-47a6-9fba-e41c2e10cffd";
const today = new Date().toISOString().slice(0, 10);

interface LiveCase {
  key: string;
  /** Another day's share, and what the taught parser must read from it. */
  next: { raw: string; value: number };
  /** A loss of the same game; taught as "I didn't finish" after the first teach. */
  loss?: { raw: string; nextLoss: string };
}

const CASES: LiveCase[] = [
  { key: "krillion", next: { raw: "Krillion #82 🦐\n1,290\n\n🫧🦑🦑🏮🫧🏮", value: 1290 } },
  {
    key: "worldle",
    next: {
      raw: "#Worldle #1451 (07.10.2026) 5/6 (88%)\n🔥 Current Win Streak: 8 days\n🟩🟨⬛⬛⬛➡️\n🟩🟩🟨⬛⬛↗️\n🟩🟩🟩🟨⬛⬆️\n🟩🟩🟩🟩⬛⬅️\n🟩🟩🟩🟩🟩🎉\n\nhttps://worldle.teuteuf.fr",
      value: 5,
    },
    loss: {
      raw: "#Worldle #1452 (08.10.2026) X/6 (71%)\n🟩🟨⬛⬛⬛↗️\n🟩🟩⬛⬛⬛⬆️\n🟩🟩🟨⬛⬛↖️\n🟩🟩🟩⬛⬛⬅️\n🟩🟩🟩🟨⬛↙️\n🟩🟩🟩🟩⬛⬇️\n\nhttps://worldle.teuteuf.fr",
      nextLoss:
        "#Worldle #1460 (16.10.2026) X/6 (40%)\n🟨⬛⬛⬛⬛↗️\n🟩⬛⬛⬛⬛⬆️\n🟩🟨⬛⬛⬛↖️\n🟩🟩⬛⬛⬛⬅️\n🟩🟩🟨⬛⬛↙️\n🟩🟩🟩⬛⬛⬇️\n\nhttps://worldle.teuteuf.fr",
    },
  },
  {
    key: "geosports",
    // The thousands-separator case the codegen benchmark tripped on.
    next: {
      raw: "GeoSports · October 7th\n1,000 / 1,000\n🟢🟢🟢🟢🟢\nwww.geosports.app",
      value: 1000,
    },
  },
  {
    key: "nytmini",
    next: {
      raw: "I solved the 10/7/2026 New York Times Mini Crossword in 12:05!\nhttps://www.nytimes.com/crosswords/game/mini",
      value: 725,
    },
  },
  {
    key: "dailytens",
    // An all-❌ grid is a score of 0, with a typed note that must not count.
    next: {
      raw: "DailyTens #413\n\n  ❌   ❌\n  ❌   ❌\n  ❌   ❌\n  ❌   ❌\n  ❌   ❌\n🏆 next time\nhttps://dailytens.com/?ref=944415",
      value: 0,
    },
  },
];

interface Row {
  game: string;
  step1Ms: number | null;
  step1Tokens: string;
  step1Correct: boolean;
  step2Ms: number | null;
  step2Tokens: string;
  attempts: number;
  gates: string;
  outcome: string;
  readBack: string;
  correct: boolean;
  lossTaught?: string;
}
const report: Row[] = [];

// The engine logs one JSON line per event; the latencies and token counts in
// the report are read back out of those lines.
const logged: Record<string, unknown>[] = [];
const realLog = console.log;

function headers(): Record<string, string> {
  return { Authorization: `Bearer ${signSession(josh)}`, "Content-Type": "application/json" };
}

async function call<T>(method: string, path: string, body?: unknown) {
  const res = await gameRoutes.request(path, {
    method,
    headers: headers(),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as T };
}

async function sql<T>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  return (await client.query<T>(query, params)).rows;
}

describe.skipIf(!LIVE)("teach v2 — live against OpenAI", () => {
  beforeAll(async () => {
    process.env.STAGE = "local";
    process.env.DATABASE_URL = "postgres://test";
    process.env.SESSION_SECRET = "x".repeat(32);
    delete process.env.DISCORD_NOTIFY_WEBHOOK_URL;
    delete process.env.TYPESAFE_API_KEY;
    resetConfigForTesting();
    console.log = (line?: unknown) => {
      try {
        logged.push(JSON.parse(String(line)) as Record<string, unknown>);
      } catch {
        realLog(line);
      }
    };
    testDb = drizzle(new PGlite());
    await migrate(testDb, { migrationsFolder: "./drizzle" });
    await sql(
      `INSERT INTO users (id, email, display_name) VALUES ($1, 'live@example.com', 'Live')`,
      [josh],
    );
  }, 60_000);

  afterAll(() => {
    console.log = realLog;
    resetConfigForTesting();
    const head =
      "| Game | Step 1 (find targets) | Step 1 picked the score | Step 2 (write code) | Attempts | Gates | Outcome | Next share read as | Correct |";
    const lines = report.map(
      (r) =>
        `| ${r.game} | ${r.step1Ms ?? "–"} ms (${r.step1Tokens}) | ${r.step1Correct ? "yes" : "NO"} | ${r.step2Ms ?? "–"} ms (${r.step2Tokens}) | ${r.attempts} | ${r.gates} | ${r.outcome} | ${r.readBack}${r.lossTaught ? `; loss: ${r.lossTaught}` : ""} | ${r.correct ? "yes" : "NO"} |`,
    );
    realLog(["", head, "|---|---|---|---|---|---|---|---|---|", ...lines, ""].join("\n"));
  });

  for (const live of CASES) {
    it(`teaches ${live.key} end to end`, async () => {
      const fixture = SCORE_SHAPE_FIXTURES.find((s) => s.key === live.key);
      if (!fixture) throw new Error(`no fixture ${live.key}`);
      // An untaught catalog row under the game's real URL, so its shares name
      // it. Seeded registry games already carry ported code: strip it.
      await sql(
        `INSERT INTO games (normalized_url, url, title) VALUES ($1, $2, $3)
         ON CONFLICT (normalized_url) DO NOTHING`,
        [fixture.normalizedUrl, `https://${fixture.normalizedUrl}`, fixture.title],
      );
      const [game] = await sql<{ id: string }>(
        `UPDATE games SET parse_code = NULL, code_version = 0 WHERE normalized_url = $1 RETURNING id`,
        [fixture.normalizedUrl],
      );
      await sql(`DELETE FROM game_code_revisions WHERE game_id = $1`, [game?.id]);
      if (!game) throw new Error("game insert failed");
      const base = `/${game.id}`;
      const row: Row = {
        game: fixture.title,
        step1Ms: null,
        step1Tokens: "",
        step1Correct: false,
        step2Ms: null,
        step2Tokens: "",
        attempts: 0,
        gates: "",
        outcome: "",
        readBack: "",
        correct: false,
      };
      report.push(row);

      // Untaught: the preview is unread and offers the score as a candidate.
      const preview = await call<PreviewGameScoreResponse>("POST", `${base}/scores/preview`, {
        scoreRaw: fixture.raw,
        periodKey: today,
      });
      expect(preview.body.preview.parseStatus).toBe("failed");
      const target = fixtureFeature(preview.body.preview.teach?.candidates ?? [], fixture.pick);
      if (!target) throw new Error("the score is not among the candidates");

      // Step 1.
      logged.length = 0;
      const labelled = await call<ScoreCandidatesResponse>("POST", `${base}/scores/candidates`, {
        scoreRaw: fixture.raw,
      });
      const targetsLog = logged.find((l) => l.kind === "teach_targets");
      row.step1Ms = Number(targetsLog?.duration_ms ?? Number.NaN);
      row.step1Tokens = `${targetsLog?.input_tokens} in / ${targetsLog?.output_tokens} out`;
      row.step1Correct = labelled.body.scoreId === target.id;

      // The user confirms the pick; the server reads the value from the text.
      const posted = await call<UpsertGameScoreResponse>("PUT", `${base}/scores`, {
        periodKey: today,
        scoreRaw: fixture.raw,
        pick: { kind: "feature", featureId: target.id },
      });
      expect(posted.body.score.scoreValue).toBe(fixture.value);
      expect(posted.body.teach?.eligible).toBe(true);

      // Step 2 + the gates.
      logged.length = 0;
      const taught = await call<TeachParserResponse>("POST", `${base}/parser/teach`, {
        periodKey: today,
        scoreDirection: fixture.direction,
      });
      const attempts = logged.filter((l) => l.kind === "parser_accept" && l.attempt);
      row.attempts = attempts.length;
      row.step2Ms = attempts.reduce((sum, a) => sum + Number(a.llm_ms ?? 0), 0);
      row.step2Tokens = `${attempts.reduce((s, a) => s + Number(a.input_tokens ?? 0), 0)} in / ${attempts.reduce((s, a) => s + Number(a.output_tokens ?? 0), 0)} out`;
      const last = attempts[attempts.length - 1];
      const evaluated = attempts.filter((a) => a.outcome !== "unavailable");
      row.attempts = evaluated.length;
      row.gates =
        evaluated.length === 0
          ? "not reached (model call timed out)"
          : last?.failed_gate
            ? `failed: ${String(last.failed_gate)}`
            : "all 4 passed";
      const timeouts = attempts.length - evaluated.length;
      if (timeouts > 0) row.step2Tokens += `, ${timeouts} call(s) timed out`;
      row.outcome = taught.body.outcome;

      // Another day's share, read by the taught code alone.
      const next = await call<UpsertGameScoreResponse>("PUT", `${base}/scores`, {
        periodKey: shiftPeriodKey(today, -1),
        scoreRaw: live.next.raw,
      });
      row.readBack = `${next.body.score.parseStatus} ${next.body.score.scoreValue ?? ""}`.trim();
      row.correct = next.body.score.scoreValue === live.next.value;

      if (live.loss) {
        // A loss is unread until someone says "I didn't finish"; that teaches the shape.
        const lost = await call<UpsertGameScoreResponse>("PUT", `${base}/scores`, {
          periodKey: shiftPeriodKey(today, -2),
          scoreRaw: live.loss.raw,
          pick: { kind: "no_result" },
        });
        const reteach = lost.body.teach?.eligible
          ? await call<TeachParserResponse>("POST", `${base}/parser/teach`, {
              periodKey: shiftPeriodKey(today, -2),
            })
          : null;
        const nextLoss = await call<UpsertGameScoreResponse>("PUT", `${base}/scores`, {
          periodKey: shiftPeriodKey(today, -3),
          scoreRaw: live.loss.nextLoss,
        });
        const stillWins = await call<PreviewGameScoreResponse>("POST", `${base}/scores/preview`, {
          scoreRaw: live.next.raw,
          periodKey: today,
        });
        row.lossTaught = `${reteach?.body.outcome ?? "already read"}, next loss ${nextLoss.body.score.parseStatus}, wins still ${stillWins.body.preview.scoreValue}`;
        row.correct =
          row.correct &&
          nextLoss.body.score.parseStatus === "no_result" &&
          stillWins.body.preview.scoreValue === live.next.value;
      }

      expect(row.outcome).toBe("accepted");
      expect(row.correct).toBe(true);
    }, 60_000);
  }
});
