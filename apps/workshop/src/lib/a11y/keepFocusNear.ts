/**
 * Keep keyboard focus near a row that is about to disappear (UX pass 5.5).
 * Native has no keyboard focus to keep, so this is a no-op there; the web
 * version is `keepFocusNear.web.ts`.
 */
export function keepFocusNearRow(_rowTestIdPrefix: string, _id: string): void {}

/** Web only: see `keepFocusNear.web.ts`. */
export function keepFocusOn(
  _testId: string,
  _opts: { force?: boolean; windowMs?: number } = {},
): void {}

export function keepFocusIfOn(_testId: string): void {}
