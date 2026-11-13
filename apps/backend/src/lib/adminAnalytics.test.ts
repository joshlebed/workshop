import { describe, expect, it } from "vitest";
import { type ActivityRow, type Bucket, versionAdoptionSegments } from "./adminAnalytics.js";

const DAYS = ["2026-11-01", "2026-11-02", "2026-11-03"];
const buckets: Bucket[] = DAYS.map((d) => ({ start: d, days: [d] }));
const row = (userId: string, day: string, platform: string, appVersion: string): ActivityRow => ({
  userId,
  day,
  platform,
  appVersion,
});

describe("versionAdoptionSegments", () => {
  it("orders bands by platform, then version, whatever order the rows arrive in", () => {
    const rows = [
      row("a", DAYS[2] ?? "", "web", "1.2.0"),
      row("b", DAYS[2] ?? "", "ios", "1.10.0"),
      row("c", DAYS[2] ?? "", "unknown", "unknown"),
      row("d", DAYS[2] ?? "", "ios", "1.9.2"),
      row("e", DAYS[2] ?? "", "web", "abc123"),
      row("f", DAYS[2] ?? "", "ios", "1.2.0"),
      row("g", DAYS[2] ?? "", "web", "1.10.0"),
      // The busiest band still sorts by version, not by size.
      row("h", DAYS[2] ?? "", "ios", "1.2.0"),
      row("i", DAYS[2] ?? "", "ios", "1.2.0"),
    ];
    const expected = [
      "ios:1.2.0",
      "ios:1.9.2",
      "ios:1.10.0",
      "web:abc123",
      "web:1.2.0",
      "web:1.10.0",
      "other:unknown",
    ];
    expect(versionAdoptionSegments(buckets, rows).map((s) => s.key)).toEqual(expected);
    expect(versionAdoptionSegments(buckets, [...rows].reverse()).map((s) => s.key)).toEqual(
      expected,
    );
  });

  it("counts a user who updated on the newer version only", () => {
    const segments = versionAdoptionSegments(buckets, [
      row("a", DAYS[0] ?? "", "ios", "1.0.0"),
      row("a", DAYS[1] ?? "", "ios", "1.0.0"),
      row("a", DAYS[1] ?? "", "ios", "1.1.0"),
    ]);
    expect(segments.map((s) => [s.key, s.points.map((p) => p.value)])).toEqual([
      ["ios:1.0.0", [1, 0, 0]],
      ["ios:1.1.0", [0, 1, 0]],
    ]);
  });

  it("keeps eleven versions and folds the least recently used into Other versions", () => {
    // 1.0.0 … 1.12.0, one user each on the last day; 1.0.0 and 1.1.0 only on the first.
    const rows = Array.from({ length: 13 }, (_, v) =>
      row(`u${v}`, v < 2 ? (DAYS[0] ?? "") : (DAYS[2] ?? ""), "ios", `1.${v}.0`),
    );
    const segments = versionAdoptionSegments(
      // Seven-bucket recency window: put the first day outside it.
      [{ start: "2026-10-01", days: ["2026-10-01"] }, ...Array.from({ length: 7 }, () => 0)].map(
        (b, i) =>
          typeof b === "number" ? { start: `2026-11-0${i + 1}`, days: [`2026-11-0${i + 1}`] } : b,
      ),
      rows.map((r) => (r.day === DAYS[0] ? { ...r, day: "2026-10-01" } : r)),
    );
    expect(segments.map((s) => s.key)).toEqual([
      ...Array.from({ length: 11 }, (_, i) => `ios:1.${i + 2}.0`),
      "other-versions",
    ]);
    expect(segments.at(-1)?.points[0]?.value).toBe(2);
  });
});
