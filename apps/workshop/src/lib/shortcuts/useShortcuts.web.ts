import { useEffect, useRef } from "react";
import { isTypingTarget, matchShortcut } from "./catalog";
import type { ShortcutHandlers } from "./useShortcuts";

export type { ShortcutHandlers } from "./useShortcuts";

/**
 * Registers page shortcuts while `enabled` (pass the screen's focus state,
 * so a screen underneath another never answers). Never fires while typing
 * in a field or while a dialog or sheet is open (`aria-modal`).
 */
export function useShortcuts(handlers: ShortcutHandlers, enabled: boolean): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const id = matchShortcut(e);
      const run = id ? ref.current[id] : undefined;
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/**
 * Escape closes a modal screen (add, paste many, the create flow, settings
 * pushes). Listens in the capture phase because react-native-web's inputs
 * stop their own keydown from bubbling, and steps aside while a sheet or
 * dialog is open (it closes first).
 */
export function useEscapeToClose(onClose: () => void, enabled: boolean): void {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      ref.current();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [enabled]);
}

/** ⌘/Ctrl+Enter commits a form, including from inside a multi-line field. */
export function useSubmitShortcut(onSubmit: () => void, enabled: boolean): void {
  const ref = useRef(onSubmit);
  ref.current = onSubmit;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || e.isComposing) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      ref.current();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [enabled]);
}
