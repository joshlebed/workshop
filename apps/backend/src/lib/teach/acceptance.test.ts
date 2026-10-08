// The acceptance gates, run through the real sandbox (host → worker → QuickJS).

import { computeScoreFeatures, findScoreFeature } from "@workshop/shared/scoreCandidates";
import { fixtureFeature, SCORE_SHAPE_FIXTURES } from "@workshop/shared/scoreShapeFixtures";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { warmGameCodeSandbox } from "../gameCode/runtime.js";
import type { ParseResult } from "../gameCode/types.js";
import { decide, describeFailures, evaluateCode } from "./acceptance.js";
import type { WindowScore } from "./types.js";

const A = "user-a";
const B = "user-b";
const C = "user-c";

const krillion = (puzzle: number, score: number) =>
  `Krillion #${puzzle} 🦐\n${score}\n\n🦑🏮🫧🦑🫧🏮`;

// Reads the number that stands alone on its own line.
const KRILLION_SCORE = `function parse(raw) {
  var m = raw.match(/^\\s*([\\d,]+)\\s*$/m);
  if (!m) throw new Error("no score line");
  return Number(m[1].replace(/,/g, ""));
}`;
// The mistake prod made: the first number in the text is the puzzle number.
const KRILLION_PUZZLE_NUMBER = `function parse(raw) {
  var m = raw.match(/#(\\d+)/);
  if (!m) throw new Error("no puzzle number");
  return Number(m[1]);
}`;

function picked(userId: string, periodKey: string, raw: string, featureId: string): WindowScore {
  const feature = findScoreFeature(raw, featureId);
  if (!feature) throw new Error(`no feature ${featureId} in ${raw}`);
  return {
    userId,
    periodKey,
    raw,
    status: "score",
    value: feature.value,
    source: "picked",
    codeVersion: 1,
    summary: raw,
    pick: { kind: "feature", feature },
    isExample: true,
  };
}

function parsed(
  userId: string,
  periodKey: string,
  raw: string,
  value: number | null,
  status: WindowScore["status"] = value === null ? "failed" : "score",
): WindowScore {
  return {
    userId,
    periodKey,
    raw,
    status,
    value,
    source: "parsed",
    codeVersion: status === null ? null : 1,
    summary: status === null ? null : raw,
    pick: null,
    isExample: false,
  };
}

/** A's pick of the score line (415) in a Krillion share. */
const scorePick = (userId = A, periodKey = "2026-10-06", puzzle = 81, score = 415) =>
  picked(userId, periodKey, krillion(puzzle, score), `number@${`Krillion #${puzzle} 🦐\n`.length}`);
/** A pick of the puzzle number instead. */
const puzzlePick = (userId: string, periodKey: string, puzzle: number, score: number) =>
  picked(userId, periodKey, krillion(puzzle, score), "number@10");

afterEach(() => {
  vi.useRealTimers();
});

beforeAll(async () => {
  // The sandbox runtime logs through `logger`, which reads the config.
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  await warmGameCodeSandbox();
}, 30_000);

describe("gate 1 — sandbox limits", () => {
  const example = scorePick();
  const evaluate = (code: string) =>
    evaluateCode({ code, currentCode: null, example, window: [example] });

  it("rejects code that does not load", async () => {
    const result = await evaluate("function parse(raw) { return (; }");
    expect(result.failedGate).toBe("sandbox_limit");
    expect(decide(result)).toBe("reject");
  });

  it("rejects code that never finishes", async () => {
    const result = await evaluate("function parse(raw) { while (true) {} }");
    expect(result.failedGate).toBe("sandbox_limit");
    expect(result.failures[0]?.actual).toMatchObject({ kind: "failed", reason: "timeout" });
  });

  it("rejects code that does not read its own example", async () => {
    const result = await evaluate(KRILLION_PUZZLE_NUMBER);
    expect(result.failedGate).toBe("reproduction");
    expect(decide(result)).toBe("reject");
  });
});

describe("gate 2 — the alteration test", () => {
  it("catches an overfit constant function", async () => {
    const example = scorePick();
    const result = await evaluateCode({
      code: "function parse(raw) { return 415; }",
      currentCode: null,
      example,
      window: [example],
    });
    expect(result.failedGate).toBe("alteration_test");
    expect(decide(result)).toBe("reject");
    expect(describeFailures(result.failures)).toContain(
      "parse must return 414 but it returned 415",
    );
  });

  it("catches code anchored on the example's own digits", async () => {
    const example = scorePick();
    const result = await evaluateCode({
      code: 'function parse(raw) { if (raw.indexOf("415") < 0) throw new Error("x"); return 415; }',
      currentCode: null,
      example,
      window: [example],
    });
    expect(result.failedGate).toBe("alteration_test");
  });

  it("catches a count that is not scoped to the picked symbol", async () => {
    const raw = "DailyTens #1\n\n  🏆   ❌\n  🏆   🏆";
    const example = picked(A, "2026-10-06", raw, "count:🏆");
    // Counts every cell, which happens to... not even match; count rows*2-1 instead.
    const result = await evaluateCode({
      code: "function parse(raw) { return raw.split('\\n').filter(function (l) { return /🏆|❌/u.test(l); }).length + 1; }",
      currentCode: null,
      example,
      window: [example],
    });
    expect(result.failedGate).toBe("alteration_test");
  });

  it("passes code that really reads the feature, on every prod shape it is given", async () => {
    const example = scorePick();
    const result = await evaluateCode({
      code: KRILLION_SCORE,
      currentCode: null,
      example,
      window: [example],
    });
    expect(result.failedGate).toBeNull();
    expect(decide(result)).toBe("accept");
  });

  it("catches code that satisfies two conflicting picks by special-casing one text", async () => {
    const earlier = puzzlePick(B, "2026-10-05", 80, 390);
    const example = scorePick();
    const result = await evaluateCode({
      code: `function parse(raw) {
        if (raw.indexOf("#80") >= 0) return 80;
        var m = raw.match(/^\\s*([\\d,]+)\\s*$/m);
        return Number(m[1]);
      }`,
      currentCode: KRILLION_PUZZLE_NUMBER,
      example,
      window: [earlier, example],
    });
    // B's example altered (#80 → #81) must follow to 81; the special case returns 390.
    expect(result.failedGate).toBe("alteration_test");
  });
});

describe("gate 3 — reproduces every confirmed pick in the window", () => {
  it("is a conflict when the code contradicts another user's confirmed pick", async () => {
    const earlier = puzzlePick(B, "2026-10-05", 80, 390);
    const example = scorePick();
    const result = await evaluateCode({
      code: KRILLION_SCORE,
      currentCode: KRILLION_PUZZLE_NUMBER,
      example,
      window: [earlier, example],
    });
    expect(result.failedGate).toBe("reproduction");
    expect(result.conflictingUsers).toEqual([B]);
    expect(result.correctingUsers).toEqual([A]);
    expect(decide(result)).toBe("conflict");
  });

  it("lets a user overturn their own earlier pick", async () => {
    const earlier = puzzlePick(A, "2026-10-05", 80, 390);
    const example = scorePick();
    const result = await evaluateCode({
      code: KRILLION_SCORE,
      currentCode: KRILLION_PUZZLE_NUMBER,
      example,
      window: [earlier, example],
    });
    expect(result.failedGate).toBeNull();
    expect(result.overturnedPicks).toEqual([{ userId: A, periodKey: "2026-10-05" }]);
    expect(decide(result)).toBe("accept");
  });

  it("ignores a pick that is not a training example", async () => {
    const stray = { ...puzzlePick(B, "2026-10-05", 80, 390), isExample: false };
    const example = scorePick();
    const result = await evaluateCode({
      code: KRILLION_SCORE,
      currentCode: null,
      example,
      window: [stray, example],
    });
    expect(result.failedGate).toBeNull();
  });

  it("holds a no-result pick to the explicit no-result value", async () => {
    const loss: WindowScore = {
      userId: B,
      periodKey: "2026-10-05",
      raw: "Wordle 1,572 X/6\n\n⬛⬛⬛⬛⬛",
      status: "no_result",
      value: null,
      source: "picked",
      codeVersion: 1,
      summary: "Wordle 1,572 X/6",
      pick: { kind: "no_result" },
      isExample: true,
    };
    const raw = "Wordle 1,573 4/6\n\n🟩🟩🟩🟩🟩";
    const example = picked(A, "2026-10-06", raw, "fraction@13");
    const throwsOnLoss = `function parse(raw) {
      var m = raw.match(/(\\d)\\/6/);
      if (!m) throw new Error("no");
      return Number(m[1]);
    }`;
    const nullOnLoss = `function parse(raw) {
      var m = raw.match(/(\\d|X)\\/6/);
      if (!m) throw new Error("no");
      return m[1] === "X" ? null : Number(m[1]);
    }`;
    const window = [loss, example];
    const bad = await evaluateCode({ code: throwsOnLoss, currentCode: null, example, window });
    expect(bad.failedGate).toBe("reproduction");
    const good = await evaluateCode({ code: nullOnLoss, currentCode: null, example, window });
    expect(good.failedGate).toBeNull();
  });
});

describe("gate 4 — other read scores stay as they are", () => {
  it("rejects code that changes another user's read score", async () => {
    const example = scorePick();
    const other = parsed(B, "2026-10-05", krillion(80, 390), 80);
    const result = await evaluateCode({
      code: KRILLION_SCORE,
      currentCode: KRILLION_PUZZLE_NUMBER,
      example,
      window: [other, example],
    });
    expect(result.failedGate).toBe("changes_other_read_scores");
    expect(result.changedReads).toMatchObject([
      {
        userId: B,
        periodKey: "2026-10-05",
        readByVersion: 1,
        result: { kind: "score", value: 390 },
      },
    ]);
    // One user is not enough to move someone else's score.
    expect(decide(result)).toBe("reject");
  });

  it("lets the teacher's own read rows follow their correction", async () => {
    const example = scorePick();
    const mine = parsed(A, "2026-10-05", krillion(80, 390), 80);
    const result = await evaluateCode({
      code: KRILLION_SCORE,
      currentCode: KRILLION_PUZZLE_NUMBER,
      example,
      window: [mine, example],
    });
    expect(result.failedGate).toBeNull();
    expect(result.rereads).toMatchObject([
      {
        userId: A,
        periodKey: "2026-10-05",
        readByVersion: 1,
        result: { kind: "score", value: 390 },
      },
    ]);
  });

  it("treats a pre-code row as read only when the current code reproduces it", async () => {
    const example = scorePick();
    // Stored by the old first-number fallback: status null, value 80.
    const legacy = parsed(B, "2026-10-05", krillion(80, 390), 80, null);
    const untaught = await evaluateCode({
      code: KRILLION_SCORE,
      currentCode: null,
      example,
      window: [legacy, example],
    });
    expect(untaught.failedGate).toBeNull();
    expect(untaught.rereads).toHaveLength(1);

    const taught = await evaluateCode({
      code: KRILLION_SCORE,
      currentCode: KRILLION_PUZZLE_NUMBER,
      example,
      window: [legacy, example],
    });
    expect(taught.failedGate).toBe("changes_other_read_scores");
  });
});

describe("after the gates — unread rows are re-read", () => {
  it("reports the unread rows the new code can read, and leaves the rest", async () => {
    const example = scorePick();
    const unread = parsed(B, "2026-10-05", krillion(80, 390), null);
    const junk = parsed(C, "2026-10-05", "hi", null);
    const result = await evaluateCode({
      code: KRILLION_SCORE,
      currentCode: null,
      example,
      window: [unread, junk, example],
    });
    expect(decide(result)).toBe("accept");
    expect(result.rereads).toMatchObject([
      {
        userId: B,
        periodKey: "2026-10-05",
        readByVersion: 1,
        result: { kind: "score", value: 390 },
      },
    ]);
  });
});

describe("a second agreeing user switches the parser", () => {
  it("switches when two users agree against one, and reports what moves", async () => {
    const outvoted = puzzlePick(C, "2026-10-04", 79, 402);
    const first = scorePick(B, "2026-10-05", 80, 390);
    const example = scorePick();
    const readByOld = parsed(C, "2026-10-05", krillion(80, 388), 80);
    const result = await evaluateCode({
      code: KRILLION_SCORE,
      currentCode: KRILLION_PUZZLE_NUMBER,
      example,
      window: [outvoted, first, readByOld, example],
    });
    expect(result.failedGate).toBe("reproduction");
    expect(result.correctingUsers.sort()).toEqual([A, B]);
    expect(result.conflictingUsers).toEqual([C]);
    expect(result.conflictingPicks).toEqual([{ userId: C, periodKey: "2026-10-04" }]);
    expect(result.changedReads).toMatchObject([
      {
        userId: C,
        periodKey: "2026-10-05",
        readByVersion: 1,
        result: { kind: "score", value: 388 },
      },
    ]);
    expect(decide(result)).toBe("switch");
  });

  it("does not switch on a tie", async () => {
    const window = [
      puzzlePick(C, "2026-10-04", 79, 402),
      puzzlePick("user-d", "2026-10-04", 79, 377),
      scorePick(B, "2026-10-05", 80, 390),
    ];
    const example = scorePick();
    const result = await evaluateCode({
      code: KRILLION_SCORE,
      currentCode: KRILLION_PUZZLE_NUMBER,
      example,
      window: [...window, example],
    });
    expect(decide(result)).toBe("conflict");
  });
});

describe("hand-written parsers for prod shapes pass all four gates", () => {
  const PARSERS: Record<string, string> = {
    dailytens: `function parse(raw) {
      var rows = raw.split(/\\r?\\n/).filter(function (l) { return /^[\\s🏆❌]+$/u.test(l) && /[🏆❌]/u.test(l); });
      if (!rows.length) throw new Error("no grid");
      return rows.join("").split("🏆").length - 1;
    }`,
    geosports: `function parse(raw) {
      var m = raw.match(/([\\d,]+)\\s*\\/\\s*1,000/);
      if (!m) throw new Error("no score");
      return Number(m[1].replace(/,/g, ""));
    }`,
    nytmini: `function parse(raw) {
      var m = raw.match(/Mini Crossword in (?:(\\d+):)?(\\d+):(\\d{2})/);
      if (!m) throw new Error("no time");
      return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    }`,
    connections: `function parse(raw) {
      var rows = raw.split(/\\r?\\n/).filter(function (l) { return /^[🟨🟩🟦🟪]{4}$/u.test(l.trim()); });
      if (!rows.length) throw new Error("no grid");
      return rows.length;
    }`,
    worldle: `function parse(raw) {
      var m = raw.match(/#Worldle\\s+#\\d+\\s+\\([^)]*\\)\\s+(\\d|X)\\/6/i);
      if (!m) throw new Error("not worldle");
      return m[1] === "X" ? null : Number(m[1]);
    }`,
  };

  for (const [key, code] of Object.entries(PARSERS)) {
    it(key, async () => {
      const fixture = SCORE_SHAPE_FIXTURES.find((s) => s.key === key);
      if (!fixture) throw new Error(`no fixture ${key}`);
      const feature = fixtureFeature(computeScoreFeatures(fixture.raw), fixture.pick);
      if (!feature) throw new Error("no feature");
      const example = picked(A, "2026-10-06", fixture.raw, feature.id);
      const window: WindowScore[] = [example];
      if (fixture.loss) window.push(parsed(B, "2026-10-06", fixture.loss, null, "no_result"));
      const result = await evaluateCode({ code, currentCode: code, example, window });
      expect(result.failures).toEqual([]);
      expect(decide(result)).toBe("accept");
    });
  }
});

describe("a sandbox that cannot run the code", () => {
  it("is neither a pass nor a verdict on the code", async () => {
    const example = scorePick();
    const result = await evaluateCode({
      code: KRILLION_SCORE,
      currentCode: null,
      example,
      window: [example],
      runParse: async () => ({ kind: "failed", reason: "sandbox_unavailable" }),
    });
    expect(result.noVerdict).toBe("sandbox_unavailable");
    expect(result.runs).toBe(1);
    expect(decide(result)).toBe("reject");
  });
});

// Reads the last number in the text: right for a "Total 415" share, right for
// the classic share — and wrong for any share with a note after the score.
const LAST_NUMBER = `function parse(raw) {
  var all = raw.replace(/https?:\\/\\/\\S+/g, "").match(/\\d[\\d,]*/g);
  if (!all) throw new Error("no number");
  return Number(all[all.length - 1].replace(/,/g, ""));
}`;
const totalShare = "Krillion #81 🦐\nTotal 415\n\n🦑🏮🫧🦑🫧🏮";
const totalPick = () =>
  picked(A, "2026-10-06", totalShare, `number@${"Krillion #81 🦐\nTotal ".length}`);

describe("one user cannot move another user's read score", () => {
  // B confirmed a score the current parser already reads. A corrects a new
  // format; the candidate reads A's share and B's — and misreads C's.
  const bystanderPick = scorePick(B, "2026-10-05", 80, 390);
  const readRow = parsed(C, "2026-10-05", `${krillion(79, 402)}\nstreak 12`, 402);

  it("a pick that merely still parses is not a second correction", async () => {
    const example = totalPick();
    const result = await evaluateCode({
      code: LAST_NUMBER,
      currentCode: KRILLION_SCORE,
      example,
      window: [bystanderPick, readRow, example],
    });
    expect(result.failedGate).toBe("changes_other_read_scores");
    expect(result.changedReads).toMatchObject([
      {
        userId: C,
        periodKey: "2026-10-05",
        readByVersion: 1,
        result: { kind: "score", value: 12 },
      },
    ]);
    // B's pick is reproduced by the new code AND by the current one: B asked
    // for nothing to change, so B is not counted.
    expect(result.correctingUsers).toEqual([A]);
    expect(result.conflictingUsers).toEqual([]);
    expect(decide(result)).toBe("reject");
  });

  it("stays rejected for one correction, whoever else's pick still parses", async () => {
    // The same candidate, taught by A alone, with no bystander pick at all.
    const example = totalPick();
    const result = await evaluateCode({
      code: LAST_NUMBER,
      currentCode: KRILLION_SCORE,
      example,
      window: [readRow, example],
    });
    expect(result.correctingUsers).toEqual([A]);
    expect(decide(result)).toBe("reject");
  });
});

describe("two matching corrections against a parser nobody confirmed", () => {
  // The seeded parser reads the puzzle number. Nobody ever picked that: it is
  // simply what the code does, and C's row was read by it.
  const readBySeed = parsed(C, "2026-10-05", krillion(80, 388), 80);

  it("is rejected for the first correction: one user cannot move C's score", async () => {
    const example = scorePick();
    const result = await evaluateCode({
      code: KRILLION_SCORE,
      currentCode: KRILLION_PUZZLE_NUMBER,
      example,
      window: [readBySeed, example],
    });
    expect(result.failedGate).toBe("changes_other_read_scores");
    expect(result.conflictingUsers).toEqual([]);
    expect(decide(result)).toBe("reject");
  });

  it("switches on the second: no pick is contradicted, and the read row is reported", async () => {
    const first = scorePick(B, "2026-10-04", 79, 402);
    const example = scorePick();
    const result = await evaluateCode({
      code: KRILLION_SCORE,
      currentCode: KRILLION_PUZZLE_NUMBER,
      example,
      window: [first, readBySeed, example],
    });
    expect(result.failedGate).toBe("changes_other_read_scores");
    expect(result.correctingUsers.sort()).toEqual([A, B]);
    expect(result.conflictingUsers).toEqual([]);
    expect(result.conflictingPicks).toEqual([]);
    expect(result.changedReads).toMatchObject([
      {
        userId: C,
        periodKey: "2026-10-05",
        readByVersion: 1,
        result: { kind: "score", value: 388 },
      },
    ]);
    expect(decide(result)).toBe("switch");
  });

  it("does not count the same user correcting twice as two corrections", async () => {
    const earlier = scorePick(A, "2026-10-04", 79, 402);
    const example = scorePick();
    const result = await evaluateCode({
      code: KRILLION_SCORE,
      currentCode: KRILLION_PUZZLE_NUMBER,
      example,
      window: [earlier, readBySeed, example],
    });
    expect(result.correctingUsers).toEqual([A]);
    expect(decide(result)).toBe("reject");
  });
});

describe("the evaluation is bounded", () => {
  it("stops with no verdict once the deadline has passed, and never accepts", async () => {
    const example = scorePick();
    const window = [
      example,
      ...Array.from({ length: 50 }, (_, i) =>
        parsed(B, `2026-09-${10 + (i % 20)}`, krillion(i, 100 + i), null),
      ),
    ];
    let calls = 0;
    const result = await evaluateCode({
      code: KRILLION_SCORE,
      currentCode: null,
      example,
      window,
      // The clock runs out after the fifth sandbox run.
      deadlineMs: Date.now() + 60_000,
      runParse: async (_code, raw) => {
        calls += 1;
        if (calls === 5) vi.setSystemTime(Date.now() + 120_000);
        const m = raw.match(/^\s*([\d,]+)\s*$/m);
        return m ? { kind: "score", value: Number(m[1]) } : { kind: "failed", reason: "threw" };
      },
    });
    expect(result.noVerdict).toBe("deadline");
    expect(calls).toBe(5);
    expect(result.failedGate).toBeNull();
    expect(decide(result)).toBe("reject");
  });

  it("stops at the first stored share that hits a sandbox limit", async () => {
    const example = scorePick();
    const window = [
      example,
      ...Array.from({ length: 30 }, (_, i) =>
        parsed(B, `2026-09-${String(i + 1).padStart(2, "0")}`, krillion(i, 100 + i), null),
      ),
    ];
    let slow = 0;
    const result = await evaluateCode({
      code: KRILLION_SCORE,
      currentCode: null,
      example,
      window,
      runParse: async (_code, raw) => {
        const m = raw.match(/^\s*([\d,]+)\s*$/m);
        const value = m ? Number(m[1]) : Number.NaN;
        // Fine on the example and its alteration; times out on every other row.
        if (value === 415 || value === 414) return { kind: "score", value };
        slow += 1;
        return { kind: "failed", reason: "timeout" };
      },
    });
    expect(result.failedGate).toBe("sandbox_limit");
    expect(slow).toBe(1);
    expect(decide(result)).toBe("reject");
  });

  it("runs the current code once per text across attempts when given a shared cache", async () => {
    const example = scorePick();
    const legacy = parsed(B, "2026-10-05", krillion(80, 390), 80, null);
    const currentResults = new Map<string, ParseResult>();
    const input = {
      code: KRILLION_SCORE,
      currentCode: KRILLION_PUZZLE_NUMBER,
      example,
      window: [legacy, example],
      currentResults,
    };
    const first = await evaluateCode(input);
    const second = await evaluateCode(input);
    // Second pass: the candidate runs again, the current code does not.
    expect(first.runs - second.runs).toBe(1);
  });
});
