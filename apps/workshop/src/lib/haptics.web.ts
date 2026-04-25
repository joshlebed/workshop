// Web has no haptics — every method is a no-op so callers don't need a
// `Platform.OS` check. Metro picks this file over `haptics.ts` on web.

export const haptics = {
  light(): void {},
  medium(): void {},
  success(): void {},
  warning(): void {},
};
