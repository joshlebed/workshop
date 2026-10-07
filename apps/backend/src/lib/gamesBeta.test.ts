import { describe, expect, it } from "vitest";
import { isGamesBetaUser } from "./gamesBeta.js";

describe("isGamesBetaUser", () => {
  it("is true for the allowlisted account ids and nobody else", () => {
    expect(isGamesBetaUser("b9a84203-b2c6-47a6-9fba-e41c2e10cffd")).toBe(true);
    expect(isGamesBetaUser("a75a758c-e3cd-46a4-ae0e-7f4e67ea1c5e")).toBe(true);
    expect(isGamesBetaUser("36d0153a-9db0-475c-8347-905628f6591a")).toBe(true);
    expect(isGamesBetaUser("6a735cdf-136d-4321-bee1-162930e05fc8")).toBe(true);
    expect(isGamesBetaUser("00000000-0000-4000-8000-000000000001")).toBe(false);
    expect(isGamesBetaUser("")).toBe(false);
  });

  it("matches ids exactly — no case folding, no prefixes", () => {
    expect(isGamesBetaUser("B9A84203-B2C6-47A6-9FBA-E41C2E10CFFD")).toBe(false);
    expect(isGamesBetaUser("b9a84203")).toBe(false);
  });
});
