// Web-only drag wiring for the album-shelf row drag handle. Native iOS uses
// react-native-gesture-handler's Pan gesture; on react-native-web the gesture
// pipeline doesn't always pick up mouse events reliably (Reanimated 4 + RNGH
// 2.30 known interplay), so we go straight to DOM pointer events here. The
// drop math + UI state are shared with the native path — only the input
// transport differs.
//
// Exported as a hook (`useWebDragHandlers`) so the AlbumShelfDetail component
// can attach the returned handlers to the drag handle on web. On native the
// handlers are no-ops.

import { useEffect, useRef } from "react";
import { Platform } from "react-native";

export interface WebDragCallbacks {
  onBegin: () => void;
  /**
   * `clientY` is the touch's viewport-Y (matches `getBoundingClientRect`).
   * `deltaY` is the offset since drag-start so the row can translateY to
   * follow the cursor visually.
   */
  onMove: (clientY: number, deltaY: number) => void;
  onEnd: () => void;
  onCancel: () => void;
}

export interface WebDragHandlers {
  onPointerDown?: (e: {
    clientY: number;
    pointerId?: number;
    preventDefault?: () => void;
    stopPropagation?: () => void;
    currentTarget?: { setPointerCapture?: (id: number) => void };
  }) => void;
}

/**
 * Returns a pointer-down handler to attach to the drag handle on web. Listens
 * for window-level pointermove / pointerup so the user can drag past the
 * handle's bounds. On native, returns an empty handler set.
 */
export function useWebDragHandlers(callbacks: WebDragCallbacks): WebDragHandlers {
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;
  // Active pointer id while a drag is in progress; null otherwise.
  const activePointerRef = useRef<number | null>(null);
  const startYRef = useRef(0);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onMove = (e: PointerEvent) => {
      if (activePointerRef.current === null) return;
      if (e.pointerId !== activePointerRef.current) return;
      // Prevent text selection / scroll during drag.
      if (e.cancelable) e.preventDefault();
      cbRef.current.onMove(e.clientY, e.clientY - startYRef.current);
    };
    const onUp = (e: PointerEvent) => {
      if (activePointerRef.current === null) return;
      if (e.pointerId !== activePointerRef.current) return;
      activePointerRef.current = null;
      cbRef.current.onEnd();
    };
    const onCancel = (e: PointerEvent) => {
      if (activePointerRef.current === null) return;
      if (e.pointerId !== activePointerRef.current) return;
      activePointerRef.current = null;
      cbRef.current.onCancel();
    };
    // `passive: false` so we can preventDefault on pointermove and stop the
    // browser from selecting text / hijacking the drag for native scrolling.
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, []);

  if (Platform.OS !== "web") return {};

  return {
    onPointerDown: (e) => {
      if (activePointerRef.current !== null) return;
      const id = e.pointerId ?? 0;
      activePointerRef.current = id;
      startYRef.current = e.clientY;
      e.preventDefault?.();
      e.stopPropagation?.();
      // Pin pointer events to this element so move/up keep firing even if
      // the user drags outside the handle's bounds.
      e.currentTarget?.setPointerCapture?.(id);
      cbRef.current.onBegin();
      cbRef.current.onMove(e.clientY, 0);
    },
  };
}
