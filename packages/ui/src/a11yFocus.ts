// Web focus helpers for dialogs (UX pass 5.5). Every function is a no-op on
// native, where there is no keyboard focus to move and VoiceOver follows
// `accessibilityViewIsModal` instead.

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type FocusableEl = {
  focus: (opts?: { preventScroll?: boolean }) => void;
  querySelectorAll?: (s: string) => ArrayLike<FocusableEl>;
  getAttribute?: (n: string) => string | null;
  getClientRects?: () => { length: number };
};

function isVisible(el: FocusableEl): boolean {
  return (el.getClientRects?.().length ?? 1) > 0 && el.getAttribute?.("aria-hidden") !== "true";
}

/**
 * Focus the first keyboard-focusable element inside `container` (a
 * react-native-web host node). Returns false when there is none (or off web).
 */
export function focusFirstFocusable(container: unknown): boolean {
  if (typeof document === "undefined" || !container) return false;
  const root = container as FocusableEl;
  const list = root.querySelectorAll?.(FOCUSABLE);
  if (!list) return false;
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    if (el && isVisible(el)) {
      el.focus();
      return true;
    }
  }
  return false;
}
