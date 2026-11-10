import type { MutualSummary } from "@workshop/shared/friends";
import { describe, expect, it } from "vitest";
import { mutualsVia } from "./mutualsVia";

const josh = { userId: "josh", displayName: "Josh" };
const sam = { userId: "sam", displayName: "Sam" };

const mutuals: MutualSummary[] = [
  { userId: "riley", displayName: "Riley", mutualCount: 2, mutualFriends: [josh, sam] },
  { userId: "quinn", displayName: "Quinn", mutualCount: 1, mutualFriends: [sam] },
  { userId: "casey", displayName: "Casey", mutualCount: 1, mutualFriends: [josh] },
];

describe("mutualsVia", () => {
  it("keeps only the people the new friend vouches for, in feed order", () => {
    expect(mutualsVia(mutuals, "josh").map((m) => m.userId)).toEqual(["riley", "casey"]);
  });

  it("is empty when the friend connects to nobody new", () => {
    expect(mutualsVia(mutuals, "nobody")).toEqual([]);
    expect(mutualsVia([], "josh")).toEqual([]);
  });
});
