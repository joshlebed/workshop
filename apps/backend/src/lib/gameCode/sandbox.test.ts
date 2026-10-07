// The sandbox's safety properties, exercised through the real path: host →
// worker thread → QuickJS. Every hostile program here must come back as a
// `failed` result within the wall-clock budget, and none may leave anything
// behind for the next run.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { logger } from "../logger.js";
import { HARD_TIMEOUT_MS, MAX_CODE_CHARS, MAX_INPUT_CHARS, MAX_SUMMARY_CHARS } from "./limits.js";
import {
  runFormat,
  runParse,
  shutdownGameCodeSandbox,
  validateCode,
  warmGameCodeSandbox,
} from "./runtime.js";

beforeAll(async () => {
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(48);
  expect(await warmGameCodeSandbox()).toBe(true);
});

afterAll(async () => {
  await shutdownGameCodeSandbox();
});

const parseBody = (body: string) => `function parse(raw) { ${body} }`;
const formatBody = (body: string) => `function format(raw) { ${body} }`;

/** Resolve with the result and how long it took. */
async function timed<T>(run: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const startedAt = performance.now();
  const result = await run();
  return { result, ms: performance.now() - startedAt };
}

// Worker restart after a kill happens inside the *next* call, so the budget
// for a single hostile call is the kill timer plus scheduling slack.
const KILL_BUDGET_MS = HARD_TIMEOUT_MS + 150;

describe("parse contract", () => {
  it("returns a number as a score", async () => {
    const code = parseBody(`var m = raw.match(/(\\d+)\\/6/); return Number(m[1]);`);
    expect(await runParse(code, "Wordle 1,234 3/6")).toEqual({ kind: "score", value: 3 });
  });

  it("keeps zero, negatives and decimals", async () => {
    expect(await runParse(parseBody("return 0;"), "x")).toEqual({ kind: "score", value: 0 });
    expect(await runParse(parseBody("return -0;"), "x")).toEqual({ kind: "score", value: 0 });
    expect(await runParse(parseBody("return -2.5;"), "x")).toEqual({ kind: "score", value: -2.5 });
  });

  it("treats an explicit null as no-result, distinct from failure", async () => {
    const code = parseBody(`return /X\\/6/.test(raw) ? null : 3;`);
    expect(await runParse(code, "Wordle 1,234 X/6")).toEqual({ kind: "noResult" });
  });

  it("accepts a top-level const arrow as well as a function declaration", async () => {
    expect(await runParse("const parse = (raw) => raw.length;", "abcd")).toEqual({
      kind: "score",
      value: 4,
    });
  });

  it.each([
    ["undefined (fell off the end)", "", "parse returned undefined"],
    ["a numeric string", `return "3";`, "parse returned string"],
    ["NaN", "return NaN;", "parse returned NaN"],
    ["Infinity", "return 1 / 0;", "parse returned Infinity"],
    ["a boolean", "return true;", "parse returned boolean"],
    ["an object", "return { value: 3 };", "parse returned object"],
    ["an array", "return [3];", "parse returned object"],
    ["an absurd magnitude", "return 1e300;", "parse returned a number out of range"],
  ])("fails on %s", async (_label, body, detail) => {
    expect(await runParse(parseBody(body), "x")).toEqual({
      kind: "failed",
      reason: "bad_return",
      detail,
    });
  });

  it("fails when the function throws, with the message as detail", async () => {
    expect(await runParse(parseBody(`throw new Error("no score line");`), "x")).toEqual({
      kind: "failed",
      reason: "threw",
      detail: "Error: no score line",
    });
  });

  it("fails on a syntax error and on a missing function", async () => {
    expect(await runParse("function parse(raw) { return ", "x")).toMatchObject({
      kind: "failed",
      reason: "invalid_code",
    });
    expect(await runParse("function somethingElse() {}", "x")).toMatchObject({
      kind: "failed",
      reason: "missing_function",
    });
  });

  it("fails an async function instead of awaiting it", async () => {
    expect(await runParse("async function parse(raw) { return 3; }", "x")).toMatchObject({
      kind: "failed",
      reason: "bad_return",
    });
  });
});

describe("format contract", () => {
  it("returns a string as the summary", async () => {
    const code = formatBody(`return raw.split("\\n")[1];`);
    expect(await runFormat(code, "Satle #1 3/6\n🟥🟥🟩")).toEqual({
      kind: "summary",
      text: "🟥🟥🟩",
    });
  });

  it("treats null and blank strings as nothing to show", async () => {
    expect(await runFormat(formatBody("return null;"), "x")).toEqual({ kind: "none" });
    expect(await runFormat(formatBody(`return "  \\n ";`), "x")).toEqual({ kind: "none" });
  });

  it("fails on a non-string return", async () => {
    expect(await runFormat(formatBody("return 5;"), "x")).toMatchObject({
      kind: "failed",
      reason: "bad_return",
    });
    expect(await runFormat(formatBody(""), "x")).toMatchObject({
      kind: "failed",
      reason: "bad_return",
    });
  });

  it("caps the output size before copying it out of the VM", async () => {
    const atCap = await runFormat(formatBody(`return "x".repeat(${MAX_SUMMARY_CHARS});`), "x");
    expect(atCap.kind).toBe("summary");
    const over = await runFormat(formatBody(`return "x".repeat(${MAX_SUMMARY_CHARS + 1});`), "x");
    expect(over).toMatchObject({ kind: "failed", reason: "too_large" });
    const huge = await runFormat(formatBody(`return "x".repeat(1500000);`), "x");
    expect(huge).toMatchObject({ kind: "failed" });
  });
});

describe("unicode", () => {
  const dailyTens = "DailyTens #751\n\n     🏆    ❌\n     🏆    🏆\n     ❌    🏆\r\n";

  it("counts emoji by literal split (Daily Tens counts 🏆)", async () => {
    const code = parseBody(`return raw.split("🏆").length - 1;`);
    expect(await runParse(code, dailyTens)).toEqual({ kind: "score", value: 4 });
  });

  it("supports the u flag, astral code points and normalize", async () => {
    const counted = parseBody(`return (raw.match(/[🏆❌]/gu) || []).length;`);
    expect(await runParse(counted, dailyTens)).toEqual({ kind: "score", value: 6 });
    const points = parseBody("return [...raw].length;");
    expect(await runParse(points, "🏆1️⃣é")).toEqual({ kind: "score", value: 5 });
    const normalized = formatBody(`return raw.normalize("NFC");`);
    expect(await runFormat(normalized, "é")).toEqual({ kind: "summary", text: "é" });
  });

  it("round-trips emoji, ZWJ sequences, flags, keycaps and CRLF unchanged", async () => {
    const echo = formatBody("return raw;");
    for (const text of ["🟩🟨⬛ 3/6", "👩‍👩‍👧‍👦 🇨🇦 1️⃣", "tab\tand\r\nCRLF"]) {
      expect(await runFormat(echo, text)).toEqual({ kind: "summary", text });
    }
  });

  it("hands the code well-formed text: a lone surrogate in the input becomes U+FFFD", async () => {
    // Half a surrogate pair cannot cross into the VM as UTF-8. Replacing it
    // up front is what makes the code see the same text every time.
    const echo = formatBody("return raw;");
    const describe = parseBody("return raw.length * 100000 + raw.charCodeAt(1);");
    const cases: Array<[string, string]> = [
      ["\uD83C", "\uFFFD"],
      ["a\uD83Cb", "a\uFFFDb"],
      ["a\uDFC6b", "a\uFFFDb"],
      // Reversed halves: two lone surrogates, not a pair.
      ["x\uDFC6\uD83Cy", "x\uFFFD\uFFFDy"],
      // A real pair is left alone.
      ["a\uD83C\uDFC6b", "a🏆b"],
    ];
    for (const [raw, seen] of cases) {
      expect(await runFormat(echo, raw)).toEqual({ kind: "summary", text: seen });
    }
    // What `parse` sees: 3 code units, the middle one U+FFFD (65533).
    expect(await runParse(describe, "a\uD83Cb")).toEqual({ kind: "score", value: 365533 });
    expect(await runParse(describe, "a\uD83C\uDFC6b")).toEqual({
      kind: "score",
      value: 4 * 100000 + 0xd83c,
    });
  });

  it("never returns a lone surrogate the code made: it comes back as replacement characters", async () => {
    const result = await runFormat(
      formatBody(`return "a" + String.fromCharCode(0xD83C) + "b";`),
      "x",
    );
    expect(result).toEqual({ kind: "summary", text: "a\uFFFD\uFFFD\uFFFDb" });
  });
});

describe("resource limits", () => {
  it("stops an infinite loop on the instruction budget", async () => {
    const { result, ms } = await timed(() => runParse(parseBody("for (;;) {}"), "x"));
    expect(result).toEqual({
      kind: "failed",
      reason: "timeout",
      detail: "instruction budget exhausted",
    });
    expect(ms).toBeLessThan(KILL_BUDGET_MS);
  });

  it("stops a loop at the top level of the code, before parse is ever called", async () => {
    const { result, ms } = await timed(() =>
      runParse("for (;;) {}\nfunction parse() { return 1; }", "x"),
    );
    expect(result).toMatchObject({ kind: "failed", reason: "timeout" });
    expect(ms).toBeLessThan(KILL_BUDGET_MS);
  });

  it("does not let try/catch/finally swallow the interrupt", async () => {
    const code = parseBody("try { for (;;) {} } catch (e) { return 1; } finally { return 2; }");
    expect(await runParse(code, "x")).toMatchObject({ kind: "failed", reason: "timeout" });
  });

  it("stops catastrophic regex backtracking", async () => {
    const code = parseBody(`return /(a+)+$/.test("a".repeat(40) + "!") ? 1 : 0;`);
    const { result, ms } = await timed(() => runParse(code, "x"));
    expect(result).toMatchObject({ kind: "failed", reason: "timeout" });
    expect(ms).toBeLessThan(KILL_BUDGET_MS);
  });

  it("fails deep recursion as a thrown stack overflow", async () => {
    const code = parseBody("return parse(raw) + 1;");
    expect(await runParse(code, "x")).toEqual({
      kind: "failed",
      reason: "threw",
      detail: "InternalError: stack overflow",
    });
  });

  it("reports native-heavy recursion as an error without losing the worker", async () => {
    // QuickJS's stack cap only counts its own stack; the parser and JSON.parse
    // burn the thread's native stack instead. Each of these, at the deepest
    // nesting the limits allow, must come back as an ordinary failure — a
    // WASM trap would cost a worker restart on every hostile post.
    const info = vi.spyOn(logger, "info");
    const room = MAX_CODE_CHARS - 80;
    const nested = (open: string, inner: string, close: string) => {
      const depth = Math.floor((room - inner.length) / (open.length + close.length));
      return `function parse(raw) { return 1; }\nvar x = ${open.repeat(depth)}${inner}${close.repeat(depth)};`;
    };
    const programs: Array<[label: string, code: string]> = [
      ["nested parentheses in the source", nested("(", "1", ")")],
      ["nested array literals in the source", nested("[", "", "]")],
      ["nested object literals in the source", nested("{a:", "1", "}")],
      [
        "nested calls in the source",
        `function f(a) { return a; }\n${nested("f(", "1", ")")}`.slice(0, MAX_CODE_CHARS),
      ],
      [
        "nested blocks in the source",
        `function parse(raw) { return 1; }\n${"{".repeat(room / 2)}${"}".repeat(room / 2)}`,
      ],
      [
        "nested unary operators in the source",
        `function parse(raw) { return 1; }\nvar x = ${"!".repeat(room)}1;`,
      ],
      [
        "nested arrow functions in the source",
        `function parse(raw) { return 1; }\nvar x = ${"()=>".repeat(room / 4)}1;`,
      ],
      [
        "JSON.parse of deeply nested arrays",
        parseBody(`return JSON.parse("[".repeat(400000) + "]".repeat(400000)).length;`),
      ],
      [
        "JSON.parse of deeply nested objects",
        parseBody(`return JSON.parse('{"a":'.repeat(200000) + "1" + "}".repeat(200000)).a;`),
      ],
      [
        "a regex with deeply nested groups",
        parseBody(
          `return new RegExp("(?:".repeat(300000) + "a" + ")".repeat(300000)).test("a") ? 1 : 0;`,
        ),
      ],
      [
        "flat() over deeply nested arrays",
        parseBody(
          "var o = []; var c = o; for (var i = 0; i < 20000; i++) { var n = []; c.push(n); c = n; } return o.flat(Infinity).length;",
        ),
      ],
      [
        "a JSON reviver that recurses",
        parseBody(
          `function f() { return JSON.parse("[1]", function () { return f(); }); } return f();`,
        ),
      ],
      [
        "a sort comparator that recurses",
        parseBody("function f() { return [2, 1].sort(function () { return f(); }); } return f();"),
      ],
      ["a getter that recurses", parseBody("var o = { get x() { return this.x; } }; return o.x;")],
    ];
    for (const [label, code] of programs) {
      expect(code.length, label).toBeLessThanOrEqual(MAX_CODE_CHARS);
      const { result, ms } = await timed(() => runParse(code, "x"));
      // Any ordinary verdict is fine (some of these are legal programs that
      // just run); what must never happen is the sandbox going away.
      if (result.kind === "failed") {
        expect(result.reason, label).not.toBe("sandbox_unavailable");
      }
      expect(ms, label).toBeLessThan(KILL_BUDGET_MS);
    }
    // The four source-nesting shapes that trapped on Node's default 4 MB
    // worker stack now fail (or run) inside the VM.
    expect(await runParse(programs[0]?.[1] ?? "", "x")).toEqual({
      kind: "failed",
      reason: "invalid_code",
      detail: "SyntaxError: stack overflow",
    });
    // No run above cost a worker: nothing started since the suite's warm-up.
    expect(info.mock.calls.filter((call) => call[0] === "game code sandbox started")).toEqual([]);
    expect(await runParse(parseBody("return 7;"), "x")).toEqual({ kind: "score", value: 7 });
    info.mockRestore();
  }, 20_000);

  it("caps memory: an allocation bomb fails instead of growing the process", async () => {
    for (const body of [
      "var a = []; for (;;) a.push([1, 2, 3, 4, 5, 6, 7, 8]);",
      `var a = {}; for (var i = 0; ; i++) a["k" + i] = { v: i };`,
      `var s = "x"; for (;;) s += s;`,
    ]) {
      const { result, ms } = await timed(() => runParse(parseBody(body), "x"));
      expect(result.kind).toBe("failed");
      expect(ms).toBeLessThan(KILL_BUDGET_MS);
    }
  });

  it("kills a built-in that never yields, then recovers on the next run", async () => {
    // `indexOf` runs to completion inside QuickJS without ticking the
    // instruction budget; only the wall-clock kill can stop it.
    const code = parseBody(`return ("a".repeat(200000) + "b").indexOf("a".repeat(100000) + "c");`);
    const { result, ms } = await timed(() => runParse(code, "x"));
    expect(result).toEqual({
      kind: "failed",
      reason: "timeout",
      detail: "wall-clock budget exhausted",
    });
    expect(ms).toBeGreaterThanOrEqual(HARD_TIMEOUT_MS - 5);
    expect(ms).toBeLessThan(KILL_BUDGET_MS);
    expect(await runParse(parseBody("return 7;"), "x")).toEqual({ kind: "score", value: 7 });
  });

  it("rejects oversized code and input without running anything", async () => {
    const bigCode = `${parseBody("return 1;")}//${"x".repeat(MAX_CODE_CHARS)}`;
    expect(await runParse(bigCode, "x")).toMatchObject({ kind: "failed", reason: "too_large" });
    expect(await runParse(parseBody("return 1;"), "x".repeat(MAX_INPUT_CHARS + 1))).toMatchObject({
      kind: "failed",
      reason: "too_large",
    });
  });
});

describe("isolation", () => {
  it("exposes no host objects, timers, I/O or module loading", async () => {
    const names = [
      "process",
      "require",
      "module",
      "fetch",
      "XMLHttpRequest",
      "setTimeout",
      "setInterval",
      "setImmediate",
      "queueMicrotask",
      "console",
      "Buffer",
      "WebAssembly",
      "Worker",
      "performance",
      "Proxy",
      "Atomics",
      "SharedArrayBuffer",
      "WeakRef",
      "FinalizationRegistry",
      "eval",
      "Function",
    ];
    const code = formatBody(
      `return ${JSON.stringify(names)}.filter(function (n) { return typeof globalThis[n] !== "undefined"; }).join(",");`,
    );
    expect(await runFormat(code, "x")).toEqual({ kind: "none" });
  });

  it("has no clock and no randomness", async () => {
    expect(await runParse(parseBody("return Date.now();"), "x")).toMatchObject({
      kind: "failed",
      reason: "threw",
      detail: "ReferenceError: 'Date' is not defined",
    });
    expect(await runParse(parseBody("return new Date().getTime();"), "x")).toMatchObject({
      kind: "failed",
      reason: "threw",
    });
    expect(await runParse(parseBody("return Math.random();"), "x")).toMatchObject({
      kind: "failed",
      reason: "threw",
    });
  });

  it("gives the same answer every time", async () => {
    const code = parseBody(
      `var o = {}; raw.split("").forEach(function (c, i) { o[c] = i; }); return Object.keys(o).join("").length + [3, 1, 2].sort()[0];`,
    );
    const first = await runParse(code, "hello world 🏆");
    for (let i = 0; i < 5; i++) expect(await runParse(code, "hello world 🏆")).toEqual(first);
  });

  it("cannot compile code at run time: eval and every function constructor are gone", async () => {
    // The classic sandbox escapes all go through one of these. Here there is
    // nothing on the other side to reach either — but removing them is also
    // what bounds how deeply nested the source the parser sees can be.
    const attempts = [
      `return eval("1");`,
      `return (0, eval)("this");`,
      `return globalThis.constructor.constructor("return this")();`,
      `return (function () {}).constructor("return 1")();`,
      `return Object.getPrototypeOf(function () {}).constructor("return this.process")();`,
      `return Object.getPrototypeOf(function* () {}).constructor("yield 1")();`,
      `return Object.getPrototypeOf(async function () {}).constructor("return 1")();`,
      `return Object.getPrototypeOf(async function* () {}).constructor("yield 1")();`,
      `try { null.x; } catch (e) { return e.constructor.constructor("return this")(); }`,
      `return new Function("return 1")();`,
      `return Reflect.construct(Object.getPrototypeOf(function () {}).constructor, ["return 1"])();`,
    ];
    for (const body of attempts) {
      const result = await runParse(parseBody(body), "x");
      expect(result, body).toMatchObject({ kind: "failed", reason: "threw" });
    }
    // Ordinary functions, closures and methods are untouched.
    const ordinary = parseBody(
      "var add = function (a) { return function (b) { return a + b; }; }; return [1, 2].map(add(1)).reduce(function (x, y) { return x + y; }, 0);",
    );
    expect(await runParse(ordinary, "x")).toEqual({ kind: "score", value: 5 });
  });

  it("starts every run from a clean global: pollution does not carry over", async () => {
    const pollute = parseBody(`
      Object.prototype.polluted = "yes";
      Array.prototype.join = function () { return "hijacked"; };
      String.prototype.match = function () { return ["9", "9"]; };
      globalThis.leak = 42;
      globalThis.parse = function () { return 999; };
      return 1;
    `);
    expect(await runParse(pollute, "x")).toEqual({ kind: "score", value: 1 });
    const probe = formatBody(
      `return [typeof ({}).polluted, [1, 2].join("-"), typeof leak, String("a1".match(/\\d/))].join("|");`,
    );
    expect(await runFormat(probe, "x")).toEqual({
      kind: "summary",
      text: "undefined|1-2|undefined|1",
    });
    expect(await runParse(parseBody("return 2;"), "x")).toEqual({ kind: "score", value: 2 });
  });

  it("reads results without trusting polluted prototypes", async () => {
    // A hostile parse tampers with the number and string machinery, then
    // returns a plain value: the host must see exactly that value.
    const code = parseBody(`
      Number.prototype.valueOf = function () { return 666; };
      Number.isFinite = function () { return true; };
      Object.defineProperty(Object.prototype, "kind", { get: function () { return "score"; } });
      return NaN;
    `);
    expect(await runParse(code, "x")).toMatchObject({ kind: "failed", reason: "bad_return" });
    const fmt = formatBody(`
      Object.defineProperty(String.prototype, "length", { get: function () { return 1; } });
      String.prototype.toString = function () { return "spoofed"; };
      return "x".repeat(${MAX_SUMMARY_CHARS + 50});
    `);
    expect(await runFormat(fmt, "x")).toMatchObject({ kind: "failed", reason: "too_large" });
  });

  it("does not run an error's getters outside the budget", async () => {
    const code = parseBody("throw { get message() { for (;;) {} } };");
    const { result, ms } = await timed(() => runParse(code, "x"));
    expect(result).toMatchObject({ kind: "failed", reason: "timeout" });
    expect(ms).toBeLessThan(KILL_BUDGET_MS);
  });

  it("never runs queued promise jobs", async () => {
    const code = parseBody("Promise.resolve().then(function () { for (;;) {} }); return 4;");
    expect(await runParse(code, "x")).toEqual({ kind: "score", value: 4 });
  });

  it("does not interpolate the input into code", async () => {
    const hostile = `"); throw new Error("injected"); ("\n\`\${1+1}\` \\u0000 </script>`;
    expect(await runFormat(formatBody("return raw;"), hostile)).toEqual({
      kind: "summary",
      text: hostile,
    });
  });

  it("serves concurrent callers one at a time with the right answers", async () => {
    const code = parseBody("return Number(raw);");
    const answers = await Promise.all(
      Array.from({ length: 25 }, (_, i) => runParse(code, String(i))),
    );
    expect(answers).toEqual(Array.from({ length: 25 }, (_, i) => ({ kind: "score", value: i })));
  });
});

describe("validateCode", () => {
  const wordle = parseBody(
    `var m = raw.match(/Wordle\\s+[\\d,]+\\s+(\\d|X)\\/6/); if (!m) throw new Error("not a Wordle share"); return m[1] === "X" ? null : Number(m[1]);`,
  );

  it("passes when every example reproduces, including no-result ones", async () => {
    const report = await validateCode({ parse: wordle }, [
      { raw: "Wordle 1,127 3/6", expected: 3 },
      { raw: "Wordle 1,128 X/6", expected: null },
    ]);
    expect(report).toEqual({ ok: true, unavailable: false, checked: 2, mismatches: [] });
  });

  it("reports each mismatch with what the code actually produced", async () => {
    const report = await validateCode({ parse: wordle }, [
      { raw: "Wordle 1,127 3/6", expected: 4 },
      { raw: "Wordle 1,128 X/6", expected: 6 },
      { raw: "not a share", expected: null },
    ]);
    expect(report.ok).toBe(false);
    expect(report.mismatches.map((m) => [m.index, m.step, m.expected, m.actual.kind])).toEqual([
      [0, "parse", 4, "score"],
      [1, "parse", 6, "noResult"],
      [2, "parse", null, "failed"],
    ]);
  });

  it("checks format: must not fail anywhere, and must match where a summary is given", async () => {
    const format = formatBody(`return raw.split("\\n")[1].trim();`);
    const good = await validateCode({ parse: wordle, format }, [
      { raw: "Wordle 1,127 3/6\n 🟩🟩 ", expected: 3, expectedSummary: "🟩🟩" },
    ]);
    expect(good.ok).toBe(true);
    const bad = await validateCode({ parse: wordle, format }, [
      { raw: "Wordle 1,127 3/6\n🟩🟩", expected: 3, expectedSummary: "🟩" },
      { raw: "Wordle 1,127 3/6", expected: 3 },
    ]);
    expect(bad.mismatches.map((m) => [m.index, m.step, m.actual.kind])).toEqual([
      [0, "format", "summary"],
      [1, "format", "failed"],
    ]);
  });

  it("rejects code that does not load even with no examples", async () => {
    expect((await validateCode({ parse: "function parse(" }, [])).ok).toBe(false);
    expect((await validateCode({ parse: "var x = 1;" }, [])).ok).toBe(false);
    expect((await validateCode({ parse: wordle, format: "nope(" }, [])).ok).toBe(false);
    expect((await validateCode({ parse: wordle }, [])).ok).toBe(true);
  });

  it("gives up after repeated wall-clock kills instead of restarting per example", async () => {
    const bomb = parseBody(`return ("a".repeat(200000) + "b").indexOf("a".repeat(100000) + "c");`);
    const examples = Array.from({ length: 6 }, () => ({ raw: "x", expected: 1 }));
    const { result, ms } = await timed(() => validateCode({ parse: bomb }, examples));
    expect(result.ok).toBe(false);
    expect(result.mismatches).toHaveLength(6);
    expect(ms).toBeLessThan(KILL_BUDGET_MS * 3);
  }, 10_000);
});
