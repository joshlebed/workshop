import { describe, expect, it } from "vitest";
import { homeListOrder } from "./homeListOrder";

const list = (
  id: string,
  over: Partial<{ archivedAt: string; pinnedAt: string; updatedAt: string }> = {},
) => ({
  id,
  archivedAt: over.archivedAt ?? null,
  pinnedAt: over.pinnedAt ?? null,
  updatedAt: over.updatedAt ?? "2026-11-01T00:00:00Z",
});

describe("homeListOrder", () => {
  it("drops hidden lists, puts pinned first, then latest activity", () => {
    const lists = [
      list("old", { updatedAt: "2026-10-01T00:00:00Z" }),
      list("hidden", { archivedAt: "2026-11-02T00:00:00Z", updatedAt: "2026-11-10T00:00:00Z" }),
      list("pinned", { pinnedAt: "2026-11-03T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" }),
      list("active", { updatedAt: "2026-10-02T00:00:00Z" }),
    ];
    const activity: Record<string, string> = { old: "2026-11-09T00:00:00Z" };
    expect(homeListOrder(lists, (id) => activity[id]).map((l) => l.id)).toEqual([
      "pinned",
      "old",
      "active",
    ]);
  });
});
