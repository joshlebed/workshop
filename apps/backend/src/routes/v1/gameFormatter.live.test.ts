// PROTOTYPE — opt-in live run of the generated-formatter prompts against the
// real OpenAI API, skipped unless TEACH_LIVE=1 (never in CI). For each game in
// `lib/gameCode/handwritten.ts`:
//
// - layer 2 (teach): one `writeCode({ withFormat: true })` call on the game's
//   first share, the format gated by `gateGeneratedFormat`, then rendered over
//   every reviewed example in the real sandbox;
// - the preview card's format-only `writeFormatCode` call, over the same.
//
// Prints a side-by-side table (reviewed summary vs each generated one) and
// writes it as markdown to $FORMATTER_LIVE_OUT when set.
//
//   cd apps/backend && set -a && . ./.env && set +a && \
//     TEACH_LIVE=1 pnpm exec vitest run src/routes/v1/gameFormatter.live.test.ts

import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, it } from "vitest";
import { resetConfigForTesting } from "../../lib/config.js";
import { HANDWRITTEN_FORMATTERS } from "../../lib/gameCode/handwritten.js";
import { HANDWRITTEN_SCORE_VALUES } from "../../lib/gameCode/handwrittenScores.js";
import { runFormat, shutdownGameCodeSandbox } from "../../lib/gameCode/runtime.js";
import { gateGeneratedFormat } from "../../lib/teach/formatGate.js";
import { writeCode, writeFormatCode } from "../../lib/teach/writeCode.js";

const LIVE = process.env.TEACH_LIVE === "1" && Boolean(process.env.OPENAI_API_KEY);
const LIVE_TIMEOUT_MS = 20_000;

interface Row {
  game: string;
  example: number;
  reviewed: string | null;
  teach: string;
  formatOnly: string;
}
const report: Row[] = [];
const notes: string[] = [];

async function renderAll(code: string | null, raws: readonly string[]) {
  const out: string[] = [];
  for (const raw of raws) {
    if (code === null) {
      out.push("–");
      continue;
    }
    const r = await runFormat(code, raw);
    out.push(
      r.kind === "summary" ? r.text : r.kind === "none" ? "(null)" : `(failed: ${r.reason})`,
    );
  }
  return out;
}

const cell = (text: string | null) =>
  text === null ? "(null)" : text.replace(/\|/g, "\\|").replace(/\n/g, "<br>");

describe.skipIf(!LIVE)("generated formatters — live against OpenAI", () => {
  beforeAll(() => {
    process.env.STAGE = "local";
    process.env.DATABASE_URL ??= "postgres://test";
    process.env.SESSION_SECRET ??= "x".repeat(32);
    resetConfigForTesting();
  });

  afterAll(async () => {
    await shutdownGameCodeSandbox();
    const lines = [
      "| Game | # | Reviewed (handwritten.ts) | Layer 2: teach call (parse + format) | Preview card: format-only call |",
      "|---|---|---|---|---|",
      ...report.map(
        (r) =>
          `| ${r.game} | ${r.example} | ${cell(r.reviewed)} | ${cell(r.teach)} | ${cell(r.formatOnly)} |`,
      ),
      "",
      ...notes.map((n) => `- ${n}`),
    ].join("\n");
    console.log(`\n${lines}\n`);
    if (process.env.FORMATTER_LIVE_OUT) writeFileSync(process.env.FORMATTER_LIVE_OUT, lines);
  });

  for (const f of HANDWRITTEN_FORMATTERS) {
    it(
      `writes a formatter for ${f.title}`,
      async () => {
        const raws = f.examples.map((e) => e.raw);
        const teachingRaw = raws[0] ?? "";
        const value = HANDWRITTEN_SCORE_VALUES[f.ref]?.[0];

        // Layer 2: one call, both blocks (expected score only steers parse).
        const both = await writeCode(
          {
            gameTitle: f.title,
            example: { raw: teachingRaw, expected: typeof value === "number" ? value : 1 },
            alsoCorrect: [],
            currentCode: null,
            withFormat: true,
          },
          { timeoutMs: 15_000 },
        );
        let teachFormat: string | null = null;
        if (!both.ok) notes.push(`${f.title}: teach call failed (${both.reason})`);
        else if (both.format === null) notes.push(`${f.title}: teach call wrote no format`);
        else {
          const gate = await gateGeneratedFormat({
            format: both.format,
            teachingRaw,
            otherRaws: raws.slice(1),
          });
          if (gate.ok) teachFormat = both.format;
          else notes.push(`${f.title}: teach format failed the gate (${gate.reason})`);
          notes.push(
            `${f.title}: teach call ${both.durationMs} ms, ${both.usage.inputTokens} in / ${both.usage.outputTokens} out`,
          );
        }

        // The preview card's call: format only, over every share at once.
        const only = await writeFormatCode({ gameTitle: f.title, raws }, { timeoutMs: 15_000 });
        let onlyFormat: string | null = null;
        if (!only.ok) notes.push(`${f.title}: format-only call failed (${only.reason})`);
        else if (only.format !== null) {
          const gate = await gateGeneratedFormat({
            format: only.format,
            teachingRaw,
            otherRaws: raws.slice(1),
          });
          if (gate.ok) onlyFormat = only.format;
          else notes.push(`${f.title}: format-only failed the gate (${gate.reason})`);
        }

        const teachOut = await renderAll(teachFormat, raws);
        const onlyOut = await renderAll(onlyFormat, raws);
        f.examples.forEach((e, i) => {
          report.push({
            game: f.title,
            example: i,
            reviewed: e.expectedSummary,
            teach: teachOut[i] ?? "–",
            formatOnly: onlyOut[i] ?? "–",
          });
        });
      },
      LIVE_TIMEOUT_MS * 2,
    );
  }
});
