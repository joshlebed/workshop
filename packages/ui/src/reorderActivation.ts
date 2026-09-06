/**
 * Shared activation thresholds for whole-card / whole-row drag-to-reorder
 * (native `react-native-reorderable-list` long-press, web dnd-kit sensors).
 *
 * The reorder surfaces are also the tap targets — a Games card is a title,
 * a cover, Play, paste and standings rows, every one of them a Pressable
 * that navigates or acts. Once a drag *activates*, the press is gone: RN's
 * Pressable suppresses `onPress` after `onLongPress` fires, and dnd-kit
 * stops the trailing `click` at document capture for 50ms after the pointer
 * lifts. So the thresholds below are the line between "a tap" and "a
 * reorder", and they have to sit clearly outside normal tap variance:
 *
 *   - Hold: 250ms swallowed hesitant taps (a 300ms tap-and-release on a
 *     leaderboard row never navigated; the second, quicker tap did). 500ms is
 *     the RN `Pressable` default and iOS's UILongPressGestureRecognizer
 *     minimum, so it matches what users' thumbs already expect.
 *   - Mouse: `distance: 4` turned any click that drifted 4px between
 *     mousedown and mouseup (trackpads do this) into a zero-displacement drag
 *     that ate the click. 10px is dnd-kit's own recommendation for draggables
 *     with clickable children.
 *   - Touch tolerance: finger travel that cancels a pending hold so a swipe
 *     scrolls instead of dragging. Unchanged.
 */
export const REORDER_ACTIVATION = {
  /** Press-and-hold before a touch (web) or native long-press lifts an item, ms. */
  longPressMs: 500,
  /** Finger travel during the hold that cancels activation (scroll wins), px. */
  touchTolerancePx: 8,
  /** Mouse travel after mousedown before a drag activates, px. */
  mouseDistancePx: 10,
} as const;
