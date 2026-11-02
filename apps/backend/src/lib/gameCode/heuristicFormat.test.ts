// PROTOTYPE — the layer-1 heuristic formatter against every reviewed example
// in handwritten.ts. Each example's verdict is pinned: `exact` must equal the
// reviewed summary; `close` / `miss` must not (so an improvement shows up as
// a failing test to re-pin, not silently). The stored block built from the
// same function must render identically inside the real QuickJS sandbox.

import { fileURLToPath } from "node:url";
import { findScoreLine, formatShareBodyHeuristic } from "@workshop/shared/formatHeuristic";
import { buildSync } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HANDWRITTEN_FORMATTERS } from "./handwritten.js";
import { HANDWRITTEN_SCORE_VALUES } from "./handwrittenScores.js";
import { heuristicFormatCode, heuristicFormatCodeFrom } from "./heuristicFormat.js";
import { runFormat, shutdownGameCodeSandbox } from "./runtime.js";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(48);
});

afterAll(async () => {
  await shutdownGameCodeSandbox();
});

type Verdict = "exact" | "close" | "miss";

/** Per handwritten example, in order: the reviewed verdict. */
const VERDICTS: Record<string, readonly Verdict[]> = {
  wordle: ["exact", "exact", "exact"],
  "wordle.louan.me": ["exact", "exact"],
  "spotle.io": ["exact", "exact"],
  framed: ["exact", "exact"],
  strands: ["exact", "exact"],
  "spelling-bee": ["miss", "miss"],
  "krillion.io": ["exact", "exact"],
  "geozee.earth": ["close"],
  "farflung.game": ["exact", "exact"],
  "magnitudle.com/size-it-up": ["close"],
  "fermi.gg": ["close", "close"],
  "gerrymandle.com": ["close"],
  "minutecryptic.com": ["close", "close"],
  "timeguessr.com": ["close"],
};

function heuristicFor(title: string, raw: string, value: number | null | undefined) {
  const scoreLine = typeof value === "number" ? findScoreLine(raw, value) : null;
  return formatShareBodyHeuristic(raw, { title, scoreLine });
}

describe("formatShareBodyHeuristic vs the hand-written formatters", () => {
  it("has a pinned case for every hand-written example", () => {
    for (const f of HANDWRITTEN_FORMATTERS) {
      expect(VERDICTS[f.ref]?.length, f.ref).toBe(f.examples.length);
      expect(HANDWRITTEN_SCORE_VALUES[f.ref]?.length, f.ref).toBe(f.examples.length);
    }
  });

  for (const f of HANDWRITTEN_FORMATTERS) {
    f.examples.forEach((example, i) => {
      const value = HANDWRITTEN_SCORE_VALUES[f.ref]?.[i];
      const verdict = VERDICTS[f.ref]?.[i] ?? "miss";
      it(`${f.title} #${i}: ${verdict}`, () => {
        const out = heuristicFor(f.title, example.raw, value);
        if (verdict === "exact") expect(out).toBe(example.expectedSummary);
        else expect(out).not.toBe(example.expectedSummary);
        // A miss is "nothing better than the raw text"; close is a real summary.
        if (verdict === "close") expect(out).not.toBeNull();
      });
    });
  }
});

describe("formatShareBodyHeuristic with no parser (no score line)", () => {
  it("keeps the grid when there is one, and short numeric lines when there is not", () => {
    expect(
      formatShareBodyHeuristic("Krillion #110 🦐\n360\n\n🦑🏮🐟🦑🐟🫧🏮", { title: "Krillion" }),
    ).toBe("🦑🏮🐟🦑🐟🫧🏮");
    expect(
      formatShareBodyHeuristic(
        "Gerrymandle #153\nWon the election in 7:47!\n💎🏆 Perfect game\n\nhttps://gerrymandle.com/day/153",
        { title: "Gerrymandle" },
      ),
    ).toBe("Won the election in 7:47!\n💎🏆 Perfect game");
  });
});

describe("findScoreLine", () => {
  it("finds plain, grouped, decimal and clock forms, token-bounded", () => {
    expect(findScoreLine("Krillion #110 🦐\n360\n\n🦑", 360)).toBe("360");
    expect(findScoreLine("TimeGuessr #1245 — 29,530/50,000", 29530)).toBe(
      "TimeGuessr #1245 — 29,530/50,000",
    );
    expect(findScoreLine("01  2.47×\n4.36× score", 4.36)).toBe("4.36× score");
    expect(findScoreLine("Gerrymandle #153\nWon the election in 7:47!", 467)).toBe(
      "Won the election in 7:47!",
    );
    // "1,962" holds neither 1 nor 962 as a token.
    expect(findScoreLine("Wordle 1,962 X/6", 1)).toBeNull();
    expect(findScoreLine("Wordle 1,962 X/6", 962)).toBeNull();
  });
});

describe("the stored heuristic block", () => {
  for (const f of HANDWRITTEN_FORMATTERS) {
    it(`${f.title}: renders in the sandbox exactly as the TS function does`, async () => {
      for (const [i, example] of f.examples.entries()) {
        const value = HANDWRITTEN_SCORE_VALUES[f.ref]?.[i];
        const parseCode =
          value === undefined
            ? null
            : `function parse(raw) { return ${value === null ? "null" : String(value)}; }`;
        const code = heuristicFormatCode({ title: f.title, parseCode });
        const result = await runFormat(code, example.raw);
        const expected = heuristicFor(f.title, example.raw, value);
        if (expected === null) expect(result.kind, JSON.stringify(result)).toBe("none");
        else expect(result).toEqual({ kind: "summary", text: expected });
      }
    });
  }

  it("never fails on text it does not recognize, or when parse throws", async () => {
    const code = heuristicFormatCode({
      title: "Anything",
      parseCode: 'function parse(raw) { throw new Error("no"); }',
    });
    for (const raw of ["", "   \n\n", "(Cheated)", "https://example.com/only-a-link", ":/"]) {
      const result = await runFormat(code, raw);
      expect(result.kind, `${JSON.stringify(raw)} → ${JSON.stringify(result)}`).not.toBe("failed");
    }
  });

  it("survives a keep-names compilation (tsx injects __name into String(fn))", async () => {
    const source = fileURLToPath(
      new URL("../../../../../packages/shared/src/formatHeuristic.ts", import.meta.url),
    );
    const out = buildSync({
      entryPoints: [source],
      bundle: true,
      write: false,
      format: "cjs",
      platform: "node",
      keepNames: true,
    }).outputFiles[0]?.text;
    if (!out) throw new Error("no esbuild output");
    expect(out).toContain("__name(");
    const mod: { exports: Record<string, unknown> } = { exports: {} };
    new Function("module", "exports", out)(mod, mod.exports);
    const fns = mod.exports as unknown as Parameters<typeof heuristicFormatCodeFrom>[0];
    const code = heuristicFormatCodeFrom(fns, {
      title: "Krillion",
      parseCode: "function parse(raw) { return 360; }",
    });
    const result = await runFormat(code, "Krillion #110 🦐\n360\n\n🦑🏮🐟🦑🐟🫧🏮");
    expect(result).toEqual({ kind: "summary", text: "🦑🏮🐟🦑🐟🫧🏮 360" });
  });

  it("drops the embedded parser when the two would not fit the code cap", () => {
    const huge = `function parse(raw) { return 1; }\n// ${"x".repeat(16_000)}`;
    expect(heuristicFormatCode({ title: "T", parseCode: huge })).not.toContain("xxxx");
  });
});
