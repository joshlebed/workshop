import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatRelative } from "./relativeTime";

describe("formatRelative", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns '—' for unparseable input", () => {
    expect(formatRelative("not-a-date")).toBe("—");
  });

  it("formats sub-minute ages in seconds", () => {
    expect(formatRelative("2026-04-30T11:59:30.000Z")).toBe("30s ago");
  });

  it("formats sub-hour ages in minutes", () => {
    expect(formatRelative("2026-04-30T11:30:00.000Z")).toBe("30m ago");
  });

  it("formats sub-day ages in hours", () => {
    expect(formatRelative("2026-04-30T07:00:00.000Z")).toBe("5h ago");
  });

  it("formats sub-2-week ages in days", () => {
    expect(formatRelative("2026-04-23T12:00:00.000Z")).toBe("7d ago");
  });

  it("falls back to a locale date for older entries", () => {
    const out = formatRelative("2026-01-01T00:00:00.000Z");
    expect(out).not.toMatch(/ago$/);
  });
});
