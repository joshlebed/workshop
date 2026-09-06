import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatGameDateLabel, localDateKey, resolveRailDate, shiftDateKey } from "./gameDate";

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

describe("resolveRailDate", () => {
  const today = "2026-09-06";

  it("keeps a valid day inside the rail", () => {
    expect(resolveRailDate("2026-09-05", today, 7)).toBe("2026-09-05");
    expect(resolveRailDate("2026-08-31", today, 7)).toBe("2026-08-31");
    expect(resolveRailDate(today, today, 7)).toBe(today);
  });

  it("takes the first value of an array param", () => {
    expect(resolveRailDate(["2026-09-04", "2026-09-05"], today, 7)).toBe("2026-09-04");
  });

  it("falls back to today when missing or malformed", () => {
    expect(resolveRailDate(undefined, today, 7)).toBe(today);
    expect(resolveRailDate("", today, 7)).toBe(today);
    expect(resolveRailDate("yesterday", today, 7)).toBe(today);
    expect(resolveRailDate("2026-9-5", today, 7)).toBe(today);
    expect(resolveRailDate("2026-02-31", today, 7)).toBe(today);
  });

  it("falls back to today when outside the rail", () => {
    expect(resolveRailDate("2026-09-07", today, 7)).toBe(today);
    expect(resolveRailDate("2026-08-30", today, 7)).toBe(today);
  });
});
