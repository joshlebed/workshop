import type { GameStandingsEntry } from "@workshop/shared/games";

/**
 * The 1–5 character score that fits under a 36px avatar in the rank strip.
 * Numeric scores print compactly ("4812", "12.5k"); a share the server read
 * as a loss prints "X"; an unread share prints "?" (the board explains).
 */
export function stripScoreLabel(
  entry: Pick<GameStandingsEntry, "scoreValue" | "parseStatus" | "scoreRaw">,
): string {
  const v = entry.scoreValue;
  if (v != null && Number.isFinite(v)) {
    if (Math.abs(v) >= 100_000) return `${Math.round(v / 1000)}k`;
    if (Math.abs(v) >= 10_000) return `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`;
    if (Number.isInteger(v)) return String(v);
    const fixed = v.toFixed(1);
    return fixed.length <= 5 ? fixed : String(Math.round(v));
  }
  if (entry.parseStatus === "no_result") return "X";
  if (entry.parseStatus === "failed") return "?";
  return entry.scoreRaw ? "✓" : "–";
}
