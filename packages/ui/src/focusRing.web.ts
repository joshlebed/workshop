import { interaction } from "./interaction";

const STYLE_ID = "workshop-focus-ring";

/**
 * Installs the app's one focus style: a 2px accent ring at low emphasis,
 * offset 2px, shown only for `:focus-visible` (keyboard), so a mouse click
 * never leaves a ring behind. Text inputs draw their own focus border
 * (`TextField`) and are excluded. Call once from an app's root layout;
 * deliberately not automatic, so a second app that imports a shared
 * component (HighScore) keeps its own focus styling.
 */
export function installWebFocusRing(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `
:focus { outline: none; }
:focus-visible:not(input):not(textarea) {
  outline: 2px solid ${interaction.focus} !important;
  outline-offset: 2px;
}
input:focus-visible, textarea:focus-visible { outline: none !important; }
`;
  document.head.appendChild(el);
}
