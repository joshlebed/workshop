/**
 * Shared autoscroll tuning for `react-native-reorderable-list` drag-to-reorder
 * (native `ItemList` + `GameCardList`).
 *
 * State of the art (dnd-kit, react-beautiful-dnd): autoscroll speed scales with
 * how close the pointer is to the edge — slow as you enter the trigger zone,
 * accelerating to a fast max at the very edge — with a trigger zone around the
 * outer ~20% of the container. `react-native-reorderable-list` does NOT do that:
 * it autoscrolls at a CONSTANT speed (`increment × speedScale` every `delay`ms),
 * so the only levers are the flat speed multiplier and the size of the edge
 * trigger zone (true edge-proportional acceleration would require patching the
 * library's worklet).
 *
 * The library defaults (`speedScale: 1`, iOS `increment: 100` / `delay: 80` →
 * ~1250px/s) made dragging an item from the bottom to the top of a long list
 * crawl. In practice a finger rests at the very edge while traversing, where a
 * proportional curve would already be at its max — so a faster constant speed
 * recovers nearly all of the benefit. We scroll ~2.5× faster and widen the
 * trigger zone to dnd-kit's common `0.2` so autoscroll engages earlier and stays
 * engaged. Pure-JS, so it OTAs.
 *
 * If it ever needs true acceleration, patch the increment in
 * `ReorderableListCore`'s autoscroll reaction to scale by the finger's depth
 * into the threshold area (the library already computes that distance), mirror
 * the existing `patches/react-native-reorderable-list.patch` across `src/` +
 * both `lib/` builds, and verify on a device.
 */
export const REORDER_AUTOSCROLL = {
  /** Fraction of the visible list (each end) that triggers autoscroll. */
  threshold: 0.2,
  /** Flat multiplier on the per-tick scroll distance (library default is 1). */
  speedScale: 2.5,
} as const;
