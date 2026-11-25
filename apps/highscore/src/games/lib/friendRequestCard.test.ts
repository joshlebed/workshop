import type { FriendRequestSummary } from "@workshop/shared/friends";
import { describe, expect, it } from "vitest";
import {
  dismissedRequestCardValue,
  friendRequestCardCopy,
  friendRequestCardTarget,
} from "./friendRequestCard";

const sam: FriendRequestSummary = {
  userId: "u-sam",
  displayName: "Sam",
  requestedAt: "2026-11-20T10:00:00.000Z",
};
const riley: FriendRequestSummary = {
  userId: "u-riley",
  displayName: " Riley ",
  requestedAt: "2026-11-24T10:00:00.000Z",
};

describe("friendRequestCardTarget", () => {
  it("shows the newest inbound request", () => {
    expect(friendRequestCardTarget([sam, riley], undefined)).toBe(riley);
    expect(friendRequestCardTarget([], undefined)).toBeNull();
  });

  it("stays hidden for the dismissed request, and comes back for a newer one", () => {
    const flag = dismissedRequestCardValue(sam, new Date("2026-11-21T00:00:00Z"));
    expect(friendRequestCardTarget([sam], flag)).toBeNull();
    expect(friendRequestCardTarget([sam, riley], flag)).toBe(riley);
    // Same person, a later request (re-sent after expiry) shows again.
    expect(
      friendRequestCardTarget([{ ...sam, requestedAt: "2026-12-10T00:00:00.000Z" }], flag),
    ).not.toBeNull();
  });

  it("ignores a malformed flag", () => {
    expect(friendRequestCardTarget([sam], { dismissedAt: "x" })).toBe(sam);
    expect(friendRequestCardTarget([sam], "nope")).toBe(sam);
  });
});

describe("friendRequestCardCopy", () => {
  it("names the sender and counts the rest", () => {
    expect(friendRequestCardCopy(riley, 1).title).toBe("Riley wants to be friends");
    expect(friendRequestCardCopy(riley, 2).detail).toBe("+1 more request in Friends");
    expect(friendRequestCardCopy(riley, 4).detail).toBe("+3 more requests in Friends");
    expect(friendRequestCardCopy({ ...sam, displayName: null }, 1).title).toBe(
      "Someone wants to be friends",
    );
  });
});
