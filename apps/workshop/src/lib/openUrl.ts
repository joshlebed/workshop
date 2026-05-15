import { Linking } from "react-native";

/**
 * Normalise a free-text URL so `Linking.openURL` (on iOS) and `window.open`
 * (on web) treat it as an external link. Items stored without a scheme (e.g.
 * `"www.maptap.gg"`) would otherwise resolve as a *relative* URL on web and
 * land the browser on something like `/list/<id>/game/www.maptap.gg`. Add
 * an `https://` prefix when no scheme is present.
 */
export function normalizeExternalUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  // Already has a scheme like `http://`, `https://`, `mailto:`, `tel:` etc.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  // Protocol-relative
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return `https://${trimmed}`;
}

/**
 * Open an item's URL externally. Returns whether the open was attempted —
 * callers can show a "no URL set" toast when this returns false. Errors from
 * `Linking.openURL` (popup blocker, unsupported scheme) are swallowed since
 * there's no meaningful retry.
 */
export function openExternalUrl(input: string | null | undefined): boolean {
  const url = normalizeExternalUrl(input);
  if (!url) return false;
  Linking.openURL(url).catch(() => {
    /* best-effort */
  });
  return true;
}
