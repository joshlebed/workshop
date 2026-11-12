/**
 * The name the display-name step starts with (UX pass 4.1).
 *
 * The backend already saves a provider's name when it gets one (Apple's
 * `fullName` on first sign-in, Google's `name` claim), and then the step is
 * skipped entirely. It only shows when the server had no name, so the
 * suggestion is whatever the client itself saw from the provider: Apple's
 * full name from the native sheet, or the `name` claim in Google's ID token.
 * Often there is none (Apple only shares a name once, and not at all with
 * Hide My Email), and the field starts empty.
 */
export const DISPLAY_NAME_MAX = 40;

function decodeBase64Url(segment: string): string | null {
  try {
    const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** The `name` claim of a JWT, unverified (display only; the server verifies). */
export function nameFromIdToken(idToken: string | null | undefined): string | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  const json = decodeBase64Url(payload);
  if (!json) return null;
  try {
    const claims: unknown = JSON.parse(json);
    if (claims && typeof claims === "object" && "name" in claims) {
      const name = (claims as { name: unknown }).name;
      return typeof name === "string" ? name : null;
    }
  } catch {
    // not JSON
  }
  return null;
}

/** Trimmed, single-spaced, cut to the field's limit; null when empty. */
export function cleanSuggestedName(raw: string | null | undefined): string | null {
  const name = raw?.replace(/\s+/g, " ").trim();
  if (!name) return null;
  return name.slice(0, DISPLAY_NAME_MAX).trim();
}
