import { useEffect, useState } from "react";

const QUERY = "(pointer: fine)";

/**
 * True on a device whose primary pointer is a mouse or trackpad: the proxy for
 * "has a hardware keyboard" that decides whether keyboard-shortcut hints
 * (`/`, "press n") are worth showing (2.14). A phone browser reports coarse.
 */
export function useFinePointer(): boolean {
  const [fine, setFine] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(QUERY).matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(QUERY);
    const onChange = () => setFine(mql.matches);
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);
  return fine;
}
