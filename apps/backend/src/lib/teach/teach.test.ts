import { describe, expect, it } from "vitest";
import { sampleWindow, worstCaseSandboxRuns } from "./teach.js";
import type { WindowScore } from "./types.js";

const row = (over: Partial<WindowScore>): WindowScore => ({
  userId: "other",
  periodKey: "2026-10-01",
  raw: "Final score: 1",
  status: "score",
  value: 1,
  source: "parsed",
  codeVersion: 1,
  pick: null,
  isExample: false,
  ...over,
});
const pick = (over: Partial<WindowScore>): WindowScore =>
  row({ source: "picked", pick: { kind: "no_result" }, isExample: true, ...over });
const example = pick({ userId: "teacher", periodKey: "2026-10-06", raw: "the example" });

describe("sampleWindow", () => {
  it("keeps a small window whole", () => {
    const window = [example, row({ raw: "a" }), row({ raw: "b" }), pick({ raw: "c" })];
    expect(sampleWindow(window, example)).toEqual({ sample: window, truncated: false });
  });

  it("cuts a busy game to the newest 200 distinct texts and says so", () => {
    // Newest first, as the window is loaded: 1,000 rows, every text different.
    const rows = Array.from({ length: 1000 }, (_, i) => row({ userId: `u${i}`, raw: `text ${i}` }));
    const { sample, truncated } = sampleWindow([example, ...rows], example);
    expect(truncated).toBe(true);
    expect(sample).toHaveLength(201);
    expect(sample[1]?.raw).toBe("text 0");
    expect(sample[200]?.raw).toBe("text 199");
  });

  it("does not count friends posting the same text twice", () => {
    const rows = Array.from({ length: 1000 }, (_, i) =>
      row({ userId: `u${i}`, raw: `text ${i % 50}` }),
    );
    const { sample, truncated } = sampleWindow([example, ...rows], example);
    expect(truncated).toBe(false);
    expect(sample).toHaveLength(1001);
  });

  it("keeps the newest 40 confirmed picks and drops picks that constrain nothing", () => {
    const picks = Array.from({ length: 60 }, (_, i) => pick({ userId: `p${i}`, raw: `pick ${i}` }));
    const stray = pick({ userId: "stray", isExample: false });
    const { sample, truncated } = sampleWindow([example, stray, ...picks], example);
    expect(truncated).toBe(true);
    expect(sample.filter((r) => r.source === "picked")).toHaveLength(41);
    expect(sample).not.toContain(stray);
  });

  it("always keeps the row being taught from", () => {
    const rows = Array.from({ length: 500 }, (_, i) => row({ raw: `text ${i}` }));
    expect(sampleWindow([...rows, example], example).sample).toContain(example);
  });
});

describe("worstCaseSandboxRuns", () => {
  it("bounds one teach at under a thousand sandbox runs", () => {
    // Per evaluation: the example, 200 window texts, 40 picks x (text + 2 alterations).
    expect(worstCaseSandboxRuns.perEvaluation).toBe(321);
    // Current code: the up-front check, 12 prompt probes, 200 texts, 40 picks.
    expect(worstCaseSandboxRuns.currentCode).toBe(253);
    expect(worstCaseSandboxRuns.adjusted).toBe(100);
    // Two model calls at most, so two evaluations.
    expect(worstCaseSandboxRuns.total).toBe(995);
  });
});
