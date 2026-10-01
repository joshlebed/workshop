import { describe, expect, it } from "vitest";
import { distillScore } from "./scoreMarks";

describe("distillScore", () => {
  it("pulls an N/6 token and a one-line grid apart", () => {
    const d = distillScore("🟥🟥🟥🟥🟩⬜ 5/6");
    expect(d.token).toBe("5/6");
    expect(d.marks).toHaveLength(6);
    expect(d.grid).toEqual([]);
    expect(d.text).toBeNull();
  });

  it("keeps a multi-row grid as rows and drops it from the strip", () => {
    const d = distillScore("🟨🟨🟩🟩\n🟦🟦🟦🟦\n🟪🟪🟪🟪");
    expect(d.grid).toHaveLength(3);
    expect(d.marks).toEqual([]);
    expect(d.token).toBeNull();
  });

  it("reads a Final score line rather than the per-round noise", () => {
    const d = distillScore("99🎯 97🔥 99🎯 98🎯 100🎯\nFinal score: 988");
    expect(d.token).toBe("988");
  });

  it("reads travle's +N and its Perfect", () => {
    expect(distillScore("✅✅✅✅✅🟧✅ +1").token).toBe("+1");
    expect(distillScore("✅✅✅✅✅✅ +0 (Perfect)").token).toBe("Perfect");
  });

  it("falls back to the raw text only when nothing structured is present", () => {
    const d = distillScore("Played it");
    expect(d.token).toBeNull();
    expect(d.text).toBe("Played it");
  });

  it("handles an absent body", () => {
    expect(distillScore(null)).toEqual({ token: null, marks: [], grid: [], text: null });
  });
});
