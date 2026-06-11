// Small helpers for inspecting postgres-js / pg driver errors. Kept driver-
// agnostic: postgres-js nests the underlying error under `.cause`, so we walk a
// short chain rather than reading the top-level object only.

/**
 * True when `e` is a unique-constraint violation (SQLSTATE 23505) for the named
 * constraint. Used by the share-slug rotation paths (lists + friend invites) to
 * retry on the rare slug collision without swallowing other failures.
 */
export function isUniqueViolation(e: unknown, constraint: string): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 5; i++) {
    if (!cur || typeof cur !== "object") return false;
    const obj = cur as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (obj.code === "23505" && obj.constraint_name === constraint) return true;
    cur = obj.cause;
  }
  return false;
}
