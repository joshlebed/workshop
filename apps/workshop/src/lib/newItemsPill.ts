// Pure helper for the "new items" pill on `app/list/[id]/index.tsx`.
//
// Returns the number of items to append to the pill's running count when a
// refetch lands. The caller still owns the running count + scroll-Y state;
// this function just answers "should this refetch bump the pill?".
//
// Returns 0 when:
//   - we have no previous baseline yet (first observation just seeds it),
//   - the user is at/near the top (the new rows render in place),
//   - or the count didn't grow (refetch was idempotent or items shrank).
export function computeNewItemsDelta(opts: {
  previousLength: number | null;
  currentLength: number;
  scrollY: number;
  threshold: number;
}): number {
  const { previousLength, currentLength, scrollY, threshold } = opts;
  if (previousLength === null) return 0;
  if (scrollY <= threshold) return 0;
  const delta = currentLength - previousLength;
  return delta > 0 ? delta : 0;
}
