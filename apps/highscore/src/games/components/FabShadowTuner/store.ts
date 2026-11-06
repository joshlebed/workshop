// TEMPORARY: live-tunable shadow parameters for the home "+" button, driven by
// the web-only slider panel in `./impl.web.tsx`. Delete this folder and inline
// the chosen values into HomeActionBar once the look is settled.

import { useSyncExternalStore } from "react";

export interface FabShadow {
  /** Soft key shadow: the main drop shadow under the disc. */
  keyColor: string;
  keyOpacity: number;
  keyRadius: number;
  keyOffsetX: number;
  keyOffsetY: number;
  /** How far the key shadow grows past the caster before blurring (px). */
  keySpread: number;
  /** Tight contact shadow right under the disc (0 opacity = off). */
  ambientOpacity: number;
  ambientRadius: number;
  ambientOffsetY: number;
  /** Hard pixel-art drop shadow: a dark copy of the disc, offset in px (0 = off). */
  pixelOffset: number;
  pixelOpacity: number;
  /** How far inside the stepped edge the round shadow caster sits. */
  casterInset: number;
  /** Pressed state multiplies key radius/offset by this. */
  pressedScale: number;
}

export const FAB_SHADOW_DEFAULTS: FabShadow = {
  keyColor: "#05030A",
  keyOpacity: 0.85,
  keyRadius: 16,
  keyOffsetX: 0,
  keyOffsetY: 12,
  keySpread: 8,
  ambientOpacity: 0.5,
  ambientRadius: 4,
  ambientOffsetY: 3,
  pixelOffset: 0,
  pixelOpacity: 0.6,
  casterInset: 3,
  pressedScale: 0.4,
};

let state: FabShadow = { ...FAB_SHADOW_DEFAULTS };
const listeners = new Set<() => void>();

export function setFabShadow(patch: Partial<FabShadow>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useFabShadow(): FabShadow {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}
