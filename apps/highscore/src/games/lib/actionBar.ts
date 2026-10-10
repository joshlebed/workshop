/**
 * Bottom padding for the home action bar: the device's bottom safe-area inset
 * (home indicator) when it is larger than the bar's own breathing room,
 * otherwise that breathing room. Keeps the bar one height on web/older phones
 * and lifts it clear of the indicator on notched iPhones.
 */
export function actionBarBottomPadding(insetBottom: number, breathingRoom: number): number {
  return Math.max(insetBottom, breathingRoom);
}
