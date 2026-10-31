import type { AdminGraphNode, AdminGraphResponse } from "@workshop/shared";
import { describe, expect, it } from "vitest";
import {
  boundsOf,
  fitTransform,
  runCommunityLayout,
  runForceLayout,
  runRadialTreeLayout,
} from "./layouts";
import { inferInviteTree } from "./model";

function user(id: string, createdAt: string, friendCount = 0): AdminGraphNode {
  return {
    id,
    displayName: id,
    email: null,
    avatarVersion: null,
    isAdmin: false,
    createdAt,
    friendCount,
    pendingOut: 0,
    pendingIn: 0,
    scoreCount: 0,
    gamesScored: 0,
    firstScoreAt: null,
    lastScoreAt: null,
    gamesOnHome: 0,
    lastActiveDay: null,
    activeDays30: 0,
    activeDaysTotal: 0,
    platforms: [],
    usedShareExtension: false,
  };
}

// Two triangles joined by one bridge, plus one loner.
const data: AdminGraphResponse = {
  generatedAt: "2026-10-31T00:00:00Z",
  nodes: [
    user("a", "2026-01-01T00:00:00Z", 3),
    user("b", "2026-01-02T00:00:00Z", 2),
    user("c", "2026-01-03T00:00:00Z", 2),
    user("d", "2026-02-01T00:00:00Z", 3),
    user("e", "2026-02-02T00:00:00Z", 2),
    user("f", "2026-02-03T00:00:00Z", 2),
    user("z", "2026-03-01T00:00:00Z", 0),
  ],
  edges: [
    { source: "a", target: "b", createdAt: "2026-01-02T01:00:00Z" },
    { source: "a", target: "c", createdAt: "2026-01-03T01:00:00Z" },
    { source: "b", target: "c", createdAt: "2026-01-04T00:00:00Z" },
    { source: "d", target: "e", createdAt: "2026-02-02T01:00:00Z" },
    { source: "d", target: "f", createdAt: "2026-02-03T01:00:00Z" },
    { source: "e", target: "f", createdAt: "2026-02-04T00:00:00Z" },
    { source: "a", target: "d", createdAt: "2026-02-05T00:00:00Z" },
  ],
};

describe("graph layouts", () => {
  it("force layout places every user at finite coordinates", () => {
    const pos = runForceLayout(data, 100);
    expect(pos.size).toBe(7);
    for (const p of pos.values()) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
  });

  it("community layout finds the two triangles and is deterministic", () => {
    const one = runCommunityLayout(data);
    const two = runCommunityLayout(data);
    expect(one.communityOf.get("a")).toBe(one.communityOf.get("b"));
    expect(one.communityOf.get("d")).toBe(one.communityOf.get("e"));
    expect(one.communityOf.get("a")).not.toBe(one.communityOf.get("d"));
    expect(one.communities[0]?.members.length).toBe(3);
    expect([...one.positions.entries()]).toEqual([...two.positions.entries()]);
    const b = boundsOf(one.positions);
    expect(Math.max(b.maxX - b.minX, b.maxY - b.minY)).toBeCloseTo(900);
  });

  it("radial tree puts the seed in the middle, generations on rings, loners outside", () => {
    const tree = inferInviteTree(data);
    const pos = runRadialTreeLayout(data, tree, 100);
    const dist = (id: string) => {
      const p = pos.get(id);
      if (!p) throw new Error(id);
      return Math.hypot(p.x, p.y);
    };
    expect(dist("a")).toBe(0);
    expect(dist("b")).toBeCloseTo(100);
    expect(dist("d")).toBeCloseTo(100);
    expect(dist("e")).toBeCloseTo(200);
    expect(dist("z")).toBeGreaterThan(dist("e"));
  });

  it("fits bounds into a viewport", () => {
    const pos = new Map([
      ["a", { x: -100, y: -50 }],
      ["b", { x: 100, y: 50 }],
    ]);
    const b = boundsOf(pos);
    expect(b).toEqual({ minX: -100, minY: -50, maxX: 100, maxY: 50 });
    const t = fitTransform(b, 400, 200, 0);
    expect(t.k).toBe(2);
    expect(t.x).toBe(200);
    expect(t.y).toBe(100);
  });
});
