/**
 * The postgres-js driver returns timestamps as `Date`; the node-postgres path
 * (used by some test harnesses) returns ISO strings. Every raw-SQL row in the
 * backend has to handle both, so callers can use these helpers instead of
 * inlining the `instanceof Date ? r.x : new Date(...)` pattern.
 */

export function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(String(value));
}

export function toIsoString(value: unknown): string {
  return toDate(value).toISOString();
}

export function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return toIsoString(value);
}
