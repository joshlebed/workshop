# Game code sandbox

Per-game score parsing and recap formatting is JavaScript stored in the database and run
on the server inside a QuickJS sandbox. The code is **untrusted**: it is written by an LLM
from text a user pasted, or by an operator. This directory is the runtime that executes it.

| File               | Role                                                                       |
| ------------------ | -------------------------------------------------------------------------- |
| `runtime.ts`       | The only entry point for callers: `runParse`, `runFormat`, `validateCode`. |
| `sandbox.ts`       | Runs one function in a fresh QuickJS context and classifies the result.    |
| `sandboxWorker.ts` | Worker-thread entry that hosts `sandbox.ts`, so a run can be killed.       |
| `limits.ts`        | Every cap, with the reason for its value.                                  |
| `types.ts`         | Result types shared by both sides.                                         |

## The contract stored code must satisfy

This section is what the teach prompt is written from. Keep it exact.

A game has two independent code blocks. Each is a plain script — not a module, so no
`import` / `export` — that defines one top-level function. Helper functions and constants
may sit beside it. The two blocks never see each other, and nothing survives between runs:
every call starts from a fresh global.

### `parse(raw)` — the score

```js
function parse(raw) {
  var m = raw.match(/Wordle\s+[\d,]+\s+(\d|X)\/6/i);
  if (!m) throw new Error("not a Wordle share");
  return m[1].toUpperCase() === "X" ? null : Number(m[1]);
}
```

`raw` is the share text exactly as the player pasted it: a string of up to 4000 UTF-16 code
units that may contain emoji, `\r\n`, URLs, and things the player typed by hand.

| `parse` does this                                                                     | Meaning                  | Stored as   |
| ------------------------------------------------------------------------------------- | ------------------------ | ----------- |
| returns a finite number, magnitude ≤ 1e12                                             | the score                | `score`     |
| returns `null`                                                                        | a real result, no score  | `no_result` |
| throws, or returns anything else (`undefined`, a string, `NaN`, an object, a promise) | could not read this text | `failed`    |

- **`null` is for a legitimate loss only** — Wordle `X/6`, Travle `(9 away)`. The text is a
  genuine share of this game and the player simply has no number.
- **Anything the code does not recognize must fail, not guess.** Throw (the message is
  logged) or fall off the end. Never return "the first number in the text": a confident
  wrong score is worse than a failure. Krillion `#81 … 415` must not become 81.
- A numeric string is a failure. Convert explicitly with `Number(...)`.

### `format(raw)` — the summary line

```js
function format(raw) {
  var rows = raw
    .split(/\r?\n/)
    .map(function (l) {
      return l.trim();
    })
    .filter(function (l) {
      return /^[⬛⬜🟨🟩]+$/u.test(l);
    });
  return rows.length ? rows.join("\n") : null;
}
```

| `format` does this                              | What the player's row shows                       |
| ----------------------------------------------- | ------------------------------------------------- |
| returns a non-blank string of ≤ 2000 code units | that string                                       |
| returns `null` (or a blank string)              | the cleaned raw text (URLs and hashtag lines cut) |
| throws, or returns anything else                | the cleaned raw text, and the failure is logged   |

A game with no format code always shows the cleaned raw text.

### What the code can and cannot use

- **Available:** ES2023 syntax, `String` / `RegExp` (including the `u` flag, named groups
  and lookbehind), `Array`, `Object`, `Math`, `Number`, `JSON`, `Map` / `Set`,
  `String.prototype.normalize`.
- **Not there:** `Date`, `Math.random`, timers, `console`, `fetch`, `require` / `import`,
  `process`, `Proxy`, typed arrays, `BigInt`, `WeakRef`. The code must be deterministic:
  the same text always gives the same answer.
- **`async` is a failure.** `Promise` exists but nothing ever awaits one.

### Things generated code gets wrong

- Numbers in a share may contain thousands separators (`1,000`) and surrounding
  whitespace; handle them.
- Anchor on labels (`Final score:`), not on line positions. Games reorder lines
  (GeoSports swapped its emoji and score lines between July and August).
- An emoji is two UTF-16 code units and a keycap digit (`1️⃣`) is three code points. Use the
  `u` flag in a character class (`/[🏆❌]/gu`), or count with `raw.split("🏆").length - 1`.
- Lines may end in `\r\n` and may carry leading spaces used to align a grid.

## Limits

Enforced on every run. Values and reasoning are in `limits.ts`.

| Limit              | Value        | When exceeded                                        |
| ------------------ | ------------ | ---------------------------------------------------- |
| Code size          | 16,000 chars | `failed` / `too_large`, nothing runs                 |
| Input size         | 4,000 chars  | `failed` / `too_large`, nothing runs                 |
| Summary size       | 2,000 chars  | `failed` / `too_large`                               |
| Memory             | 2 MB heap    | `failed` / `out_of_memory`                           |
| Stack              | 256 KB       | `failed` / `threw` (`InternalError: stack overflow`) |
| Instruction budget | 200 ticks    | `failed` / `timeout` — about 10 ms of a tight loop   |
| Wall clock         | 250 ms       | the worker thread is killed; `failed` / `timeout`    |

Two timers, because they stop different things:

- **The instruction budget** counts QuickJS interrupt ticks (loop iterations, calls, regex
  backtracking steps). It is a count, not a clock, so a given code + input always gets the
  same verdict no matter how loaded the host is. It stops infinite loops and catastrophic
  regexes in 10–70 ms.
- **The wall clock** exists because QuickJS built-ins run to completion without ticking:
  `("a".repeat(2e5) + "b").indexOf("a".repeat(1e5) + "c")` never yields. Only killing the
  thread stops it. The next run starts a new thread (~75 ms; ~300 ms on a throttled Lambda).

Isolation: every run gets a new QuickJS runtime and context, so globals and prototype
changes never carry over. No host function is ever exposed to the VM, and the input is
passed as a value, never spliced into code. The worker thread itself is started with an
empty environment.

## Host API (`runtime.ts`)

```ts
runParse(code, raw): Promise<ParseResult>
//  { kind: "score", value } | { kind: "noResult" } | { kind: "failed", reason, detail? }

runFormat(code, raw): Promise<FormatResult>
//  { kind: "summary", text } | { kind: "none" } | { kind: "failed", reason, detail? }

validateCode({ parse, format? }, examples): Promise<{ ok, checked, mismatches }>
//  examples: [{ raw, expected: number | null, expectedSummary?: string | null }]
```

None of them throws or rejects for anything the code does. `reason` is one of
`invalid_code`, `missing_function`, `threw`, `timeout`, `out_of_memory`, `bad_return`,
`too_large`, `sandbox_unavailable`.

`validateCode` is the gate for storing code: `parse` must reproduce every `expected`
(`null` means it must return "no result"), and `format`, when given, must not fail on any
example and must match every `expectedSummary` that is set. With no examples it still
proves each block loads and defines its function.

## Measured cost

`scripts/bench-game-code.mjs`, against the built bundle. "Lambda-like" is the
`public.ecr.aws/lambda/nodejs:20` image limited to 0.29 vCPU and 512 MB, which is what the
function's memory setting buys; it has not been measured on Lambda itself.

|                                                      | Unthrottled (Node 20)  | Lambda-like (0.29 vCPU)                       |
| ---------------------------------------------------- | ---------------------- | --------------------------------------------- |
| Worker cold start (once per container, on first use) | 75 ms p50, 100 ms max  | 300 ms p50, 400 ms max                        |
| First run after start                                | 1.2 ms                 | 1.3 ms p50                                    |
| Warm `parse` / `format`                              | 0.6 ms p50, 1.2 ms p99 | 0.6–0.7 ms p50, ~80 ms p99 (scheduler stalls) |
| Infinite loop                                        | 12 ms                  | 12 ms p50                                     |
| Regex backtracking                                   | 67 ms                  | 215 ms, or killed at 250 ms                   |
| Allocation bomb                                      | 42 ms                  | 180 ms                                        |

- **Lambda init is unaffected.** Nothing loads until the first run; the handler bundle does
  not contain QuickJS. The sandbox ships as its own file, `dist/gameCodeWorker.cjs`
  (890 KB, WASM embedded), which adds ~0.3 MB to `lambda.zip`.
- **The ~80 ms p99 under throttling is the scheduler, not the sandbox**: a container held
  to 0.29 vCPU is paused for the rest of each 100 ms period once it has used its share. It
  is why the wall clock is 250 ms and not 50.
- QuickJS is compiled with V8's baseline WASM compiler only; see `loadQuickJS` in
  `sandbox.ts` for why, and re-run the benchmark when the Node runtime changes.
