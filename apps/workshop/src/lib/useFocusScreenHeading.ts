import { usePathname } from "expo-router";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

/**
 * Web (UX pass 5.5): after a navigation, move focus to the new screen's
 * level-1 heading, so a screen-reader or keyboard user starts at the top of
 * the page they opened instead of on a control of the page they left (or on
 * `<body>`). Not on the first page load, where the browser's own start is
 * right. The heading gets `tabindex="-1"` (focusable by script, not by Tab)
 * and `data-focus-heading`, which `installWebFocusRing()` exempts from the
 * ring: the move is for assistive tech, not a visible state.
 *
 * Left alone when the new screen has already put focus in a text field
 * (an `autoFocus` add form) or a dialog is open. Native does nothing:
 * react-navigation already moves VoiceOver to the new screen.
 */
export function useFocusScreenHeading(): void {
  const pathname = usePathname();
  const firstRef = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per navigation, keyed on the path.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    if (firstRef.current) {
      firstRef.current = false;
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const attempt = () => {
      if (document.querySelector('[aria-modal="true"]')) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && isTextEntry(active) && isShown(active)) return;
      const heading = currentScreenHeading();
      if (!heading) {
        // The screen may still be loading (a skeleton before its title).
        tries += 1;
        if (tries < 12) timer = setTimeout(attempt, 100);
        return;
      }
      heading.setAttribute("tabindex", "-1");
      heading.setAttribute("data-focus-heading", "");
      heading.focus({ preventScroll: true });
    };
    timer = setTimeout(attempt, 120);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [pathname]);
}

/** A tiny mount point for the root layout. */
export function ScreenHeadingFocus(): null {
  useFocusScreenHeading();
  return null;
}

function isTextEntry(el: HTMLElement): boolean {
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

function isShown(el: Element): boolean {
  if (el.getClientRects().length === 0) return false;
  return el.closest('[aria-hidden="true"], [inert]') == null;
}

/**
 * The visible level-1 heading of the screen on top. Stack screens behind the
 * current one stay in the DOM (hidden), and on desktop the open list sits
 * after the sidebar, so the last shown level-1 heading in document order is
 * the new screen's.
 */
function currentScreenHeading(): HTMLElement | null {
  const all = Array.from(
    document.querySelectorAll<HTMLElement>('h1, [role="heading"][aria-level="1"]'),
  ).filter(isShown);
  return all[all.length - 1] ?? null;
}
