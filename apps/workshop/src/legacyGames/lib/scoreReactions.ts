// Optimistic helper for emoji score reactions (G2c). Mirrors the server's
// tapback rule — one reaction per reactor — so the chips update instantly on
// tap and reconcile against the server echo / next poll afterwards.

import type { ScoreReactionSummary } from "@workshop/shared/games";

export type ReactionChange = { type: "set"; emoji: string } | { type: "remove" };

/**
 * Apply the viewer's own reaction change to a score's summaries, optimistically.
 * The viewer is first stripped from whatever emoji they currently hold (a
 * reactor can only be in one summary), empty summaries collapse, then for a
 * `set` they're added to the target emoji (appended as a new chip if needed).
 */
export function applyViewerReaction(
  reactions: ScoreReactionSummary[],
  viewer: { userId: string; displayName: string | null },
  change: ReactionChange,
): ScoreReactionSummary[] {
  const stripped = reactions
    .map((r) => {
      if (!r.reactors.some((x) => x.userId === viewer.userId)) return r;
      const reactors = r.reactors.filter((x) => x.userId !== viewer.userId);
      return { ...r, reactors, count: reactors.length, viewerReacted: false };
    })
    .filter((r) => r.count > 0);

  if (change.type === "remove") return stripped;

  const reactor = { userId: viewer.userId, displayName: viewer.displayName };
  if (stripped.some((r) => r.emoji === change.emoji)) {
    return stripped.map((r) =>
      r.emoji === change.emoji
        ? { ...r, reactors: [...r.reactors, reactor], count: r.count + 1, viewerReacted: true }
        : r,
    );
  }
  return [...stripped, { emoji: change.emoji, count: 1, reactors: [reactor], viewerReacted: true }];
}
