import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { daysBack, formatGameDateLabel, localDateKey, shiftDateKey } from "./gameDate";

describe("daysBack", () => {
  it("returns 0 for today", () => {
    expect(daysBack("2026-05-15", "2026-05-15")).toBe(0);
  });

  it("returns 1 for yesterday", () => {
    expect(daysBack("2026-05-14", "2026-05-15")).toBe(1);
  });

  it("counts across month boundaries", () => {
    expect(daysBack("2026-02-28", "2026-03-02")).toBe(2);
  });

  it("clamps future dates to 0", () => {
    expect(daysBack("2026-05-16", "2026-05-15")).toBe(0);
  });

  it("returns 0 for malformed input", () => {
    expect(daysBack("not-a-date", "2026-05-15")).toBe(0);
  });
});

describe("localDateKey", () => {
  it("formats a local date as YYYY-MM-DD", () => {
    // Construct in local time so test is timezone-stable.
    const d = new Date(2026, 0, 5); // Jan 5, 2026
    expect(localDateKey(d)).toBe("2026-01-05");
  });

  it("zero-pads month and day", () => {
    const d = new Date(2026, 8, 9); // Sep 9, 2026
    expect(localDateKey(d)).toBe("2026-09-09");
  });
});

describe("shiftDateKey", () => {
  it("returns yesterday for delta -1", () => {
    expect(shiftDateKey("2026-05-15", -1)).toBe("2026-05-14");
  });

  it("returns tomorrow for delta +1", () => {
    expect(shiftDateKey("2026-05-15", 1)).toBe("2026-05-16");
  });

  it("rolls across a month boundary", () => {
    expect(shiftDateKey("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("rolls across a year boundary", () => {
    expect(shiftDateKey("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("returns the input on a malformed date", () => {
    expect(shiftDateKey("nope", -1)).toBe("nope");
  });
});

describe("formatGameDateLabel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Tie "today" to a concrete date in tests' local time.
    vi.setSystemTime(new Date(2026, 4, 15, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("labels today as Today", () => {
    expect(formatGameDateLabel("2026-05-15")).toBe("Today");
  });

  it("labels yesterday as Yesterday", () => {
    expect(formatGameDateLabel("2026-05-14")).toBe("Yesterday");
  });

  it("falls back to a locale month/day for older days in the same year", () => {
    const label = formatGameDateLabel("2026-05-01");
    // Locale formatting varies across environments; just confirm the
    // result is non-empty and doesn't equal the shortcut labels.
    expect(label).not.toBe("Today");
    expect(label).not.toBe("Yesterday");
    expect(label.length).toBeGreaterThan(0);
  });
});
