import { describe, expect, it } from "vitest";
import { toDate, toIsoOrNull, toIsoString } from "./dates.js";

describe("toDate", () => {
  it("returns a Date instance unchanged", () => {
    const d = new Date("2024-01-02T03:04:05.000Z");
    expect(toDate(d)).toBe(d);
  });

  it("parses an ISO string into a Date", () => {
    const d = toDate("2024-01-02T03:04:05.000Z");
    expect(d.toISOString()).toBe("2024-01-02T03:04:05.000Z");
  });
});

describe("toIsoString", () => {
  it("converts a Date to an ISO string", () => {
    expect(toIsoString(new Date("2024-01-02T03:04:05.000Z"))).toBe("2024-01-02T03:04:05.000Z");
  });

  it("converts an ISO string to a (re-normalised) ISO string", () => {
    expect(toIsoString("2024-01-02T03:04:05.000Z")).toBe("2024-01-02T03:04:05.000Z");
  });
});

describe("toIsoOrNull", () => {
  it("returns null for null", () => {
    expect(toIsoOrNull(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(toIsoOrNull(undefined)).toBeNull();
  });

  it("converts a Date to an ISO string", () => {
    expect(toIsoOrNull(new Date("2024-01-02T03:04:05.000Z"))).toBe("2024-01-02T03:04:05.000Z");
  });

  it("converts a string to an ISO string", () => {
    expect(toIsoOrNull("2024-01-02T03:04:05.000Z")).toBe("2024-01-02T03:04:05.000Z");
  });
});
