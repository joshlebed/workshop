/**
 * Standard competition ranking (1, 2, 2, 4) — the single implementation
 * behind the Games standings routes.
 *
 * Returns a new array in display order, in three groups:
 *
 * 1. Entries with a numeric score, sorted by score in `direction` ('desc' =
 *    bigger is better) and ranked from 1.
 * 2. Entries the game's stored code read as `no_result` — a real result with
 *    no score, i.e. a loss. They rank LAST: every one of them gets the rank
 *    after all the scores (three scores → each loss is 4th), tied with each
 *    other.
 * 3. Everything else with no score, unranked (`rank: null`): `failed` rows
 *    (the code could not read the text) and rows the legacy parser wrote with
 *    no value, where a loss and an unread share were never told apart.
 *
 * Groups 2 and 3 keep their original relative order, and the sort in group 1
 * is stable, so callers can pre-order ties (e.g. by updated_at) in SQL and
 * that order survives ranking. An entry with no `parseStatus` is treated
 * exactly as it was before stored code existed.
 *
 * (Order and copy: docs/highscore-score-validation-spec.md, "Standings order".)
 */
export function rankEntries<T extends { scoreValue: number | null; parseStatus?: string }>(
  entries: readonly T[],
  direction: "asc" | "desc",
): (T & { rank: number | null })[] {
  const hasScore = (e: T) => typeof e.scoreValue === "number" && Number.isFinite(e.scoreValue);
  const isLoss = (e: T) => !hasScore(e) && e.parseStatus === "no_result";
  const played = entries.filter(hasScore);
  const lost = entries.filter(isLoss);
  const unranked = entries.filter((e) => !hasScore(e) && !isLoss(e));
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
  const lastPlace = played.length + 1;
  return [
    ...ranked,
    ...lost.map((e) => ({ ...e, rank: lastPlace })),
    ...unranked.map((e) => ({ ...e, rank: null })),
  ];
}
