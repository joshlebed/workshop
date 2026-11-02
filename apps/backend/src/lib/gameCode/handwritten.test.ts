// Every hand-written formatter runs in the real sandbox against its examples:
// a block that fails to load, throws, or renders a share differently from the
// reviewed `expectedSummary` fails here before it reaches a database.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HANDWRITTEN_FORMATTERS } from "./handwritten.js";
import { runFormat, shutdownGameCodeSandbox, validateCode } from "./runtime.js";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(48);
});

afterAll(async () => {
  await shutdownGameCodeSandbox();
});

const PARSE_STUB = "function parse(raw) { return 1; }\n";

describe("hand-written formatters", () => {
  it("name each game once", () => {
    const refs = HANDWRITTEN_FORMATTERS.map((f) => f.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });

  for (const formatter of HANDWRITTEN_FORMATTERS) {
    it(`${formatter.title}: renders every example as reviewed`, async () => {
      const report = await validateCode(
        { parse: PARSE_STUB, format: formatter.format },
        formatter.examples.map((e) => ({ raw: e.raw, expectedSummary: e.expectedSummary })),
      );
      expect(report.unavailable).toBe(false);
      expect(report.mismatches).toEqual([]);
    });

    it(`${formatter.title}: never throws on text it does not recognize`, async () => {
      for (const raw of ["", "   \n\n", "(Cheated)", "https://example.com/only-a-link", ":/"]) {
        const result = await runFormat(formatter.format, raw);
        expect(result.kind, `${JSON.stringify(raw)} → ${JSON.stringify(result)}`).not.toBe(
          "failed",
        );
      }
    });
  }
});
