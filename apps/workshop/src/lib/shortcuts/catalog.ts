// The keyboard shortcuts Workshop has on web (UX pass 5.7b), in one place so
// the shortcuts sheet lists exactly what the handlers do. Each entry is
// matched by `matchShortcut` (pure, unit-tested) from a keydown.

export type ShortcutId = "search" | "new" | "activity" | "help" | "escape" | "submit" | "undo";

export interface ShortcutEntry {
  id: ShortcutId;
  /** Keys as shown in the sheet, one cap each. */
  keys: string[];
  /** An alternative chord, shown after "or". */
  alt?: string[];
  label: string;
  /** Where it works, in a few words. */
  where: string;
}

export const SHORTCUTS: ShortcutEntry[] = [
  {
    id: "search",
    keys: ["/"],
    alt: ["⌘", "K"],
    label: "Search",
    where: "Your lists, or inside a list",
  },
  {
    id: "new",
    keys: ["N"],
    label: "New list, or add to the open list",
    where: "Your lists, or inside a list",
  },
  {
    id: "submit",
    keys: ["⌘", "Enter"],
    label: "Add all, or create the list",
    where: "Paste many, new list",
  },
  {
    id: "escape",
    keys: ["Esc"],
    label: "Close, or clear the search",
    where: "Sheets, add, new list, settings",
  },
  {
    id: "undo",
    keys: ["⌘", "Z"],
    label: "Undo, while its toast is showing",
    where: "Everywhere",
  },
  { id: "activity", keys: ["⌘", "/"], label: "Activity", where: "Everywhere" },
  { id: "help", keys: ["?"], label: "Keyboard shortcuts", where: "Everywhere" },
];

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
}

/**
 * Which global shortcut a keydown is, or null. `escape` and `submit` are
 * handled by the screens and fields that own them, so they never match here.
 */
export function matchShortcut(e: KeyLike): ShortcutId | null {
  if (e.altKey) return null;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "k") return "search";
  if (mod && e.key === "/") return "activity";
  if (mod && !e.shiftKey && e.key.toLowerCase() === "z") return "undo";
  if (mod) return null;
  if (e.key === "/") return "search";
  if (e.key === "n" || e.key === "N") return e.shiftKey ? null : "new";
  if (e.key === "?") return "help";
  return null;
}

/** True when keystrokes belong to a field, not to the page. */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (n: string) => string | null;
  };
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  const role = el.getAttribute?.("role");
  return role === "textbox" || role === "searchbox" || role === "combobox";
}
