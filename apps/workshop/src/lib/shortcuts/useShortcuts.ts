import type { ShortcutId } from "./catalog";

export type ShortcutHandlers = Partial<Record<ShortcutId, () => void>>;

/** Keyboard shortcuts are web-only; native has nothing to listen to. */
export function useShortcuts(_handlers: ShortcutHandlers, _enabled: boolean): void {}

/** Escape closes a modal screen (web only). */
export function useEscapeToClose(_onClose: () => void, _enabled: boolean): void {}

/** ⌘/Ctrl+Enter commits a form (web only). */
export function useSubmitShortcut(_onSubmit: () => void, _enabled: boolean): void {}
