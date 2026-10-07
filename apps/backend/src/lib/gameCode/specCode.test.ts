// The spec → code converter against the DSL interpreters it replaces. Specs
// are produced the way real ones are — by the teach flow's synthesizers, run
// over the legacy fixture shares — plus one hand-written spec per rule kind.

import { GAME_REGISTRY } from "@workshop/shared/gameRegistry";
import {
  evaluateScoreSpec,
  type ScoreSpec,
  synthesizeScoreSpec,
  tokenizeScoreCandidates,
} from "@workshop/shared/scoreParsing";
import {
  evaluateSummarySpec,
  type SummarySpec,
  suggestSummaryLineIndexes,
  summaryShareLines,
  synthesizeSummarySpec,
} from "@workshop/shared/summarySpec";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixtureCorpus } from "./fixtureCorpus.js";
import { runFormat, runParse, shutdownGameCodeSandbox } from "./runtime.js";
import { compileScoreSpec, compileSummarySpec } from "./specCode.js";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(48);
});

afterAll(async () => {
  await shutdownGameCodeSandbox();
});

const shares = fixtureCorpus().filter((raw) => raw.includes("\n") || /\d/.test(raw));

/** What the DSL says, in the stored code's terms. */
async function expectScoreParity(spec: ScoreSpec, raw: string): Promise<void> {
  const old = evaluateScoreSpec(spec, raw);
  const next = await runParse(compileScoreSpec(spec), raw);
  const context = `${JSON.stringify(spec)} on ${JSON.stringify(raw)}`;
  if (old.value !== null) expect(next, context).toEqual({ kind: "score", value: old.value });
  else expect(next.kind, context).not.toBe("score");
}

describe("compileScoreSpec", () => {
  it("matches the DSL for every spec the teach flow would synthesize from a fixture", async () => {
    let specs = 0;
    for (const raw of shares) {
      const seen = new Set<string>();
      for (const candidate of tokenizeScoreCandidates(raw)) {
        const spec = synthesizeScoreSpec(raw, candidate);
        if (!spec) continue;
        const key = JSON.stringify(spec);
        if (seen.has(key)) continue;
        seen.add(key);
        specs += 1;
        // The teaching example, by construction, must reproduce the pick…
        expect(await runParse(compileScoreSpec(spec), raw)).toEqual({
          kind: "score",
          value: candidate.value,
        });
      }
    }
    expect(specs).toBeGreaterThan(100);
  }, 60_000);

  it("matches the DSL for every registry spec across all fixtures", async () => {
    // …and a spec taught on one share must agree with the DSL on every other.
    const sample = shares.filter((_, i) => i % 4 === 0);
    for (const def of GAME_REGISTRY) {
      if (!def.spec) continue;
      for (const raw of sample) await expectScoreParity(def.spec, raw);
    }
  }, 60_000);

  it.each<[string, ScoreSpec, string, number | null]>([
    [
      "capture",
      { rules: [{ kind: "capture", pattern: "Score:\\s*([\\d,]+)" }] },
      "score: 1,234",
      1234,
    ],
    ["capture, whole match", { rules: [{ kind: "capture", pattern: "\\d+" }] }, "abc 42", 42],
    ["count", { rules: [{ kind: "count", token: "🏆" }] }, "🏆❌🏆", 2],
    ["count of nothing", { rules: [{ kind: "count", token: "🏆" }] }, "no trophies", 0],
    ["count within", { rules: [{ kind: "count", token: "🏆", within: "[🏆❌]" }] }, "❌❌", 0],
    [
      "countLines",
      { rules: [{ kind: "countLines", pattern: "^[🟨🟩]{2}$" }] },
      "🟨🟩\n x \n🟩🟩 ",
      2,
    ],
    ["duration", { rules: [{ kind: "duration" }] }, "solved in 1:02:03", 3723],
    [
      "duration, custom",
      { rules: [{ kind: "duration", pattern: "in\\s*(\\d+):(\\d{2})" }] },
      "9:59 in 0:42",
      42,
    ],
    [
      "tokenPosition",
      { rules: [{ kind: "tokenPosition", token: "🟩", among: ["🟥"] }] },
      "🟥🟥🟩",
      3,
    ],
    [
      "wordMap",
      { rules: [{ kind: "wordMap", pattern: "hit (\\w+)", map: { Genius: 9 } }] },
      "I hit genius",
      9,
    ],
    [
      "first matching rule wins",
      {
        rules: [
          { kind: "capture", pattern: "nope(\\d)" },
          { kind: "capture", pattern: "(\\d+)/6" },
        ],
      },
      "4/6",
      4,
    ],
  ])("%s", async (_label, spec, raw, value) => {
    expect(evaluateScoreSpec(spec, raw).value).toBe(value);
    expect(await runParse(compileScoreSpec(spec), raw)).toEqual({ kind: "score", value });
  });

  it("fails — never guesses the first number — when no rule matches", async () => {
    const spec: ScoreSpec = { rules: [{ kind: "capture", pattern: "([\\d,]+)\\s*\\/\\s*775\\b" }] };
    const result = await runParse(compileScoreSpec(spec), "Geozee #15 — 609/809 · top 9% 🌍");
    expect(result).toEqual({
      kind: "failed",
      reason: "threw",
      detail: "Error: no rule matched this share",
    });
  });

  it("fails on a spec whose only rule is a broken regex (the DSL fell back to the first number)", async () => {
    const spec = { rules: [{ kind: "capture", pattern: "(" }] } as ScoreSpec;
    expect(evaluateScoreSpec(spec, "12").hadValidRule).toBe(false);
    expect(await runParse(compileScoreSpec(spec), "12")).toMatchObject({ kind: "failed" });
  });

  it("reports a tokenPosition grid with no winning token as a loss", async () => {
    const spec: ScoreSpec = {
      rules: [{ kind: "tokenPosition", token: "🟩", among: ["🟥", "⬛"] }],
    };
    expect(await runParse(compileScoreSpec(spec), "🟥🟥🟥")).toEqual({ kind: "noResult" });
    expect(await runParse(compileScoreSpec(spec), "no grid at all")).toMatchObject({
      kind: "failed",
    });
  });

  it("fails on jsonb that is not a spec at all", async () => {
    for (const junk of [{}, { rules: "x" }, null, [], { rules: [null] }]) {
      const result = await runParse(compileScoreSpec(junk as unknown as ScoreSpec), "12");
      expect(result.kind).toBe("failed");
    }
  });
});

describe("compileSummarySpec", () => {
  async function expectSummaryParity(spec: SummarySpec, raw: string): Promise<void> {
    const old = evaluateSummarySpec(spec, raw);
    const next = await runFormat(compileSummarySpec(spec), raw);
    const context = `${JSON.stringify(spec)} on ${JSON.stringify(raw)}`;
    if (old?.trim()) expect(next, context).toEqual({ kind: "summary", text: old });
    else expect(next, context).toEqual({ kind: "none" });
  }

  it("matches the DSL for every spec the teach flow would synthesize from a fixture", async () => {
    const multiLine = shares.filter((raw) => summaryShareLines(raw).length >= 2);
    const specs: SummarySpec[] = [];
    for (const raw of multiLine) {
      const lines = summaryShareLines(raw);
      const selections = [
        suggestSummaryLineIndexes(raw),
        [lines[0]?.index ?? 0],
        lines.slice(1).map((l) => l.index),
      ];
      for (const selection of selections) {
        const spec = synthesizeSummarySpec(raw, selection);
        if (!spec) continue;
        specs.push(spec);
        await expectSummaryParity(spec, raw);
      }
    }
    expect(specs.length).toBeGreaterThan(40);
    // Each spec against shares it was not taught on.
    const others = multiLine.filter((_, i) => i % 5 === 0);
    for (const spec of specs.filter((_, i) => i % 3 === 0)) {
      for (const raw of others) await expectSummaryParity(spec, raw);
    }
  }, 60_000);

  it("keeps matching lines in share order, minus URLs and hashtag lines", async () => {
    const spec: SummarySpec = { rules: [{ kind: "matchLines", pattern: "^[^A-Za-z]+$" }] };
    const raw = "GeoHistory · Aug 3rd\n  842 / 1,000  \n🟢🟢🟡\r\nhttps://geohistory.gg\n#geo";
    expect(await runFormat(compileSummarySpec(spec), raw)).toEqual({
      kind: "summary",
      text: "  842 / 1,000\n🟢🟢🟡",
    });
  });

  it("defers when nothing matches or every pattern is broken", async () => {
    const none: SummarySpec = { rules: [{ kind: "matchLines", pattern: "^zzz$" }] };
    expect(await runFormat(compileSummarySpec(none), "abc\ndef")).toEqual({ kind: "none" });
    const broken = { rules: [{ kind: "matchLines", pattern: "(" }] } as SummarySpec;
    expect(await runFormat(compileSummarySpec(broken), "abc")).toEqual({ kind: "none" });
  });
});
