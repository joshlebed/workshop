/**
 * Standard competition ranking (1, 2, 2, 4) — the single implementation
 * behind both the Lists leaderboard routes and the Games standings routes.
 *
 * Returns a new array in display order: entries with a numeric score first,
 * sorted by score in `direction` ('desc' = bigger is better), then unplayed
 * entries (rank: null) in their original relative order. The sort is stable,
 * so callers can pre-order ties (e.g. by updated_at) in SQL and that order
 * survives ranking.
 */
export function rankEntries<T extends { scoreValue: number | null }>(
  entries: readonly T[],
  direction: "asc" | "desc",
): (T & { rank: number | null })[] {
  const hasScore = (e: T) => typeof e.scoreValue === "number" && Number.isFinite(e.scoreValue);
  const played = entries.filter(hasScore);
  const unplayed = entries.filter((e) => !hasScore(e));
  played.sort((a, b) => {
    const av = a.scoreValue as number;
    const bv = b.scoreValue as number;
    return direction === "desc" ? bv - av : av - bv;
  });
  let lastValue: number | null = null;
  let lastRank = 0;
  const ranked = played.map((e, i) => {
    const v = e.scoreValue as number;
    const rank = lastValue !== null && v === lastValue ? lastRank : i + 1;
    lastValue = v;
    lastRank = rank;
    return { ...e, rank };
  });
  return [...ranked, ...unplayed.map((e) => ({ ...e, rank: null }))];
}
