// The HighScore client reads a share's score with the same `runJob` as the
// server, on the plain-JS build of the same QuickJS version (Hermes has no
// WebAssembly). This file is what makes "the same reading" a tested claim
// rather than a hope: every stored registry parser, over every fixture share,
// must come out identical on both builds — as must the limits.

import asmVariant from "@jitl/quickjs-asmjs-mjs-release-sync";
import { newQuickJSWASMModuleFromVariant, type QuickJSWASMModule } from "quickjs-emscripten-core";
import { beforeAll, describe, expect, it } from "vitest";
import { BUILTIN_GAME_CODE } from "./builtin.js";
import { fixtureCorpus } from "./fixtureCorpus.js";
import { loadQuickJS, runJob } from "./sandbox.js";
import type { SandboxJob } from "./types.js";

let server: QuickJSWASMModule;
let device: QuickJSWASMModule;

beforeAll(async () => {
  server = await loadQuickJS();
  device = await newQuickJSWASMModuleFromVariant(asmVariant);
}, 60_000);

const both = (job: SandboxJob) => ({ server: runJob(server, job), device: runJob(device, job) });

describe("the client's QuickJS build reads what the server's does", () => {
  // Parsers only: `format` never runs on a client (the summary is the server's).
  it("for every registry parser over every fixture share", () => {
    const texts = fixtureCorpus();
    let runs = 0;
    for (const [key, code] of Object.entries(BUILTIN_GAME_CODE)) {
      if (!code?.parse) continue;
      for (const raw of texts) {
        const result = both({ fn: "parse", code: code.parse, raw });
        expect(result.device, `${key} ${JSON.stringify(raw.slice(0, 60))}`).toEqual(result.server);
        runs += 1;
      }
    }
    expect(runs).toBeGreaterThan(500);
  }, 120_000);

  it("for emoji, surrogates and the number shapes parsers trip on", () => {
    const code = String.raw`function parse(raw) {
      var squares = (raw.match(/🟩/gu) || []).length;
      var m = raw.match(/([\d,]+)\s*\/\s*([\d,]+)/);
      if (!m) return squares || null;
      return Number(m[1].replace(/,/g, "")) + squares + [...raw].length + raw.normalize("NFD").length;
    }`;
    for (const raw of [
      "1,000 / 1,000 🟩🟩⬛",
      "Score 3/6\r\n🟩🟨⬜️ 1️⃣",
      "x\uDFC6\uD83Cy 12/20",
      "café 7 / 10",
      "nothing here",
    ]) {
      const result = both({ fn: "parse", code, raw });
      expect(result.device, raw).toEqual(result.server);
    }
  });

  it("and fails the same way at the same limits", () => {
    const cases: Array<[string, string, string]> = [
      ["a loop", "function parse(raw) { for (;;) {} }", "x"],
      [
        "regex backtracking",
        "function parse(raw) { return /(a+)+$/.test(raw) ? 1 : 2; }",
        `${"a".repeat(40)}!`,
      ],
      [
        "an allocation bomb",
        "function parse(raw) { var a = []; for (;;) a.push(raw + a.length); }",
        "x".repeat(500),
      ],
      ["deep recursion", "function parse(raw) { return parse(raw); }", "x"],
      ["a throw", 'function parse(raw) { throw new Error("no"); }', "x"],
      ["a bad return", 'function parse(raw) { return "7"; }', "x"],
      ["a syntax error", "function parse(raw) {", "x"],
      ["no function", "var x = 1;", "x"],
      ["eval", 'function parse(raw) { return eval("1"); }', "x"],
      [
        "the Function constructor",
        'function parse(raw) { return (function () {}).constructor("return 1")(); }',
        "x",
      ],
      ["Date", "function parse(raw) { return Date.now(); }", "x"],
    ];
    for (const [name, code, raw] of cases) {
      const result = both({ fn: "parse", code, raw });
      expect(result.device, name).toEqual(result.server);
      expect(result.device.kind, name).toBe("failed");
    }
  }, 60_000);
});
