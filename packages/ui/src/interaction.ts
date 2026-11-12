import { Platform } from "react-native";
import { alpha, tokens } from "./theme";

/**
 * Shared interaction-state vocabulary for every pressable primitive.
 *
 * Hover and pressed are translucent steps of `text.primary` over whatever the
 * control sits on, so the same row reads correctly on the canvas, a surface
 * or a sheet. Focus is the one ring drawn by `installWebFocusRing()` (web,
 * `:focus-visible` only, so a mouse click never shows it).
 */
export const interaction = {
  hover: alpha(tokens.text.primary, 0.05),
  pressed: alpha(tokens.text.primary, 0.09),
  /** The one focus color: the accent at low emphasis, never a white ring. */
  focus: alpha(tokens.accent.default, 0.6),
} as const;

/** react-native-web's Pressable passes `hovered` / `focused` beside `pressed`. */
export type PressState = { pressed: boolean; hovered?: boolean; focused?: boolean };

/**
 * ARIA state that react-native-web reads but React Native's own prop types
 * don't declare (`aria-pressed`, `aria-level`, …). Returned only on web so
 * native views never receive an unknown prop. Spread it onto the element.
 */
export function webAria(attrs: Record<string, string | number | boolean | undefined>) {
  if (Platform.OS !== "web") return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) out[k] = v;
  return out as object;
}

/**
 * Web: Space activates a checkbox, switch, radio or menu item (ARIA
 * keyboard patterns). react-native-web's Pressable only maps Space to
 * `role="button"`, so these roles answered Enter alone. Spread onto the
 * `Pressable`; returns `{}` on native.
 */
export function webSpaceKey(onPress: (() => void) | undefined): object {
  if (Platform.OS !== "web" || !onPress) return {};
  return {
    onKeyDown: (e: { key: string; preventDefault: () => void; repeat?: boolean }) => {
      if (e.key !== " " && e.key !== "Spacebar") return;
      e.preventDefault();
      if (!e.repeat) onPress();
    },
  };
}
