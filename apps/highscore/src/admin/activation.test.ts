import { describe, expect, it } from "vitest";
import { formatActivationCell, funnelCounts } from "./activation";

describe("formatActivationCell", () => {
  it("prints a rounded percent and the ratio", () => {
    expect(formatActivationCell({ reached: 9, eligible: 16 })).toEqual({
      pct: "56%",
      ratio: "9/16",
    });
  });

  it("prints a dash when nobody is old enough to count", () => {
    expect(formatActivationCell({ reached: 0, eligible: 0 })).toEqual({ pct: "—", ratio: "" });
  });
});

describe("funnelCounts", () => {
  it("lists every stage in order, zero-filling missing ones", () => {
    expect(
      funnelCounts({ trigger: "poke", label: "Poke", stages: { accepted: 2, os_granted: 1 } }),
    ).toEqual([
      { stage: "shown", value: 0 },
      { stage: "accepted", value: 2 },
      { stage: "declined", value: 0 },
      { stage: "os_granted", value: 1 },
      { stage: "os_denied", value: 0 },
    ]);
  });
});
