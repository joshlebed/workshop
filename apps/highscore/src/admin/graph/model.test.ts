import type { AdminGraphNode, AdminGraphResponse } from "@workshop/shared";
import { describe, expect, it } from "vitest";
import {
  activityBand,
  adjacency,
  cohortLabel,
  cohorts,
  displayName,
  friendsOf,
  inferInviteTree,
  radiusFor,
  sortUsers,
  subtreeSize,
  timeDomain,
} from "./model";

function user(id: string, createdAt: string, extra: Partial<AdminGraphNode> = {}): AdminGraphNode {
  return {
    id,
    displayName: id.toUpperCase(),
    email: `${id}@x.test`,
    avatarVersion: null,
    isAdmin: false,
    createdAt,
    friendCount: 0,
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
    ...extra,
  };
}

// a (seed) brings in b, b brings in c; d is a second seed who later friends c.
const data: AdminGraphResponse = {
  generatedAt: "2026-10-31T00:00:00Z",
  nodes: [
    user("a", "2026-01-01T00:00:00Z"),
    user("b", "2026-02-01T00:00:00Z"),
    user("c", "2026-03-01T00:00:00Z"),
    user("d", "2026-02-15T00:00:00Z"),
  ],
  edges: [
    { source: "a", target: "b", createdAt: "2026-02-02T00:00:00Z" },
    { source: "b", target: "c", createdAt: "2026-03-02T00:00:00Z" },
    { source: "c", target: "d", createdAt: "2026-04-01T00:00:00Z" },
  ],
};

describe("admin graph model", () => {
  it("builds adjacency and friend lists oldest-first", () => {
    const adj = adjacency(data.edges);
    expect([...(adj.get("c") ?? [])].sort()).toEqual(["b", "d"]);
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    expect(friendsOf("c", data.edges, byId).map((f) => f.node.id)).toEqual(["b", "d"]);
  });

  it("infers the invite tree from the earliest friendship with an older account", () => {
    const tree = inferInviteTree(data);
    expect(tree.roots).toEqual(["a", "d"]);
    expect(tree.parent.get("b")).toBe("a");
    expect(tree.parent.get("c")).toBe("b"); // b's edge came first, d is older but later
    expect(tree.depth.get("c")).toBe(2);
    expect(tree.depth.get("d")).toBe(0);
    expect(subtreeSize(tree, "a")).toBe(2);
    expect(tree.treeEdgeKeys).toEqual(new Set(["a|b", "b|c"]));
  });

  it("derives cohorts, labels, time domain and radii", () => {
    expect(cohorts(data.nodes)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(cohortLabel("2026-02")).toBe("Feb 2026");
    expect(timeDomain(data)).toEqual({
      start: Date.parse("2026-01-01T00:00:00Z"),
      end: Date.parse("2026-04-01T00:00:00Z"),
    });
    expect(radiusFor({ scoreCount: 0 })).toBe(6);
    expect(radiusFor({ scoreCount: 10_000 })).toBe(22);
  });

  it("bands activity and names users", () => {
    const now = new Date("2026-10-31T12:00:00Z");
    expect(activityBand({ lastActiveDay: "2026-10-30" }, now)).toBe("week");
    expect(activityBand({ lastActiveDay: "2026-10-10" }, now)).toBe("month");
    expect(activityBand({ lastActiveDay: "2026-08-01" }, now)).toBe("dormant");
    expect(activityBand({ lastActiveDay: null }, now)).toBe("never");
    expect(displayName({ displayName: "  ", email: "pat@x.test" })).toBe("pat");
    expect(displayName({ displayName: null, email: null })).toBe("Unnamed");
  });

  it("sorts users with never-active rows last either direction", () => {
    const rows = [
      user("x", "2026-01-01T00:00:00Z", { lastActiveDay: null, scoreCount: 5 }),
      user("y", "2026-01-02T00:00:00Z", { lastActiveDay: "2026-10-01", scoreCount: 1 }),
      user("z", "2026-01-03T00:00:00Z", { lastActiveDay: "2026-10-20", scoreCount: 9 }),
    ];
    expect(sortUsers(rows, "lastActiveDay", true).map((r) => r.id)).toEqual(["z", "y", "x"]);
    expect(sortUsers(rows, "lastActiveDay", false).map((r) => r.id)).toEqual(["y", "z", "x"]);
    expect(sortUsers(rows, "scoreCount", true).map((r) => r.id)).toEqual(["z", "x", "y"]);
    expect(sortUsers(rows, "name", false).map((r) => r.id)).toEqual(["x", "y", "z"]);
  });
});
