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
  onMove: (absoluteY: number) => void;
  onEnd: () => void;
  onCancel: () => void;
}

export interface WebDragHandlers {
  onPointerDown?: (e: { clientY: number; pointerId?: number; preventDefault?: () => void }) => void;
}

/**
 * Returns pointer-down handler to attach to the drag handle on web. Listens
 * for window-level pointermove / pointerup so the user can drag past the
 * handle's bounds. On native, returns an empty handler set.
 */
export function useWebDragHandlers(callbacks: WebDragCallbacks): WebDragHandlers {
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;
  // Active pointer id while a drag is in progress; null otherwise.
  const activePointerRef = useRef<number | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onMove = (e: PointerEvent) => {
      if (activePointerRef.current === null) return;
      if (e.pointerId !== activePointerRef.current) return;
      cbRef.current.onMove(e.clientY);
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
    window.addEventListener("pointermove", onMove);
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
      activePointerRef.current = e.pointerId ?? 0;
      e.preventDefault?.();
      cbRef.current.onBegin();
      cbRef.current.onMove(e.clientY);
    },
  };
}
