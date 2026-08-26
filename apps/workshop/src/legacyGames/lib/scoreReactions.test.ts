import type { ScoreReactionSummary } from "@workshop/shared/games";
import { describe, expect, it } from "vitest";
import { applyViewerReaction } from "./scoreReactions";

const me = { userId: "me", displayName: "Me" };
const alex = { userId: "alex", displayName: "Alex" };

function summary(
  emoji: string,
  reactors: { userId: string; displayName: string | null }[],
  viewer = false,
): ScoreReactionSummary {
  return { emoji, count: reactors.length, reactors, viewerReacted: viewer };
}

describe("applyViewerReaction", () => {
  it("adds a brand-new emoji chip when the viewer hasn't reacted", () => {
    const next = applyViewerReaction([], me, { type: "set", emoji: "🔥" });
    expect(next).toEqual([summary("🔥", [me], true)]);
  });

  it("joins an existing emoji and bumps its count", () => {
    const start = [summary("🔥", [alex])];
    const next = applyViewerReaction(start, me, { type: "set", emoji: "🔥" });
    expect(next).toEqual([summary("🔥", [alex, me], true)]);
  });

  it("replaces the viewer's prior emoji (tapback: one per reactor)", () => {
    const start = [summary("👍", [me], true), summary("🔥", [alex])];
    const next = applyViewerReaction(start, me, { type: "set", emoji: "🔥" });
    // 👍 had only the viewer, so it collapses; viewer moves to 🔥.
    expect(next).toEqual([summary("🔥", [alex, me], true)]);
  });

  it("keeps an emoji others still hold when the viewer leaves it", () => {
    const start = [summary("🔥", [alex, me], true)];
    const next = applyViewerReaction(start, me, { type: "remove" });
    expect(next).toEqual([summary("🔥", [alex])]);
  });

  it("removes the viewer's solo chip entirely on remove", () => {
    const start = [summary("👏", [me], true)];
    expect(applyViewerReaction(start, me, { type: "remove" })).toEqual([]);
  });

  it("is a no-op remove when the viewer hasn't reacted", () => {
    const start = [summary("🎉", [alex])];
    expect(applyViewerReaction(start, me, { type: "remove" })).toEqual(start);
  });
});
