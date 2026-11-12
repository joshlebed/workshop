/**
 * Post-sign-in return path (UX pass 0.3).
 *
 * `ListPublicLanding` stashes where a signed-out visitor was (the short share
 * URL `/l/:slug` or the canonical `/list/:id`) before sending them to sign in.
 * AuthGate reads it once sign-in (and the display-name step) completes and
 * sends them back. Only those two in-app shapes are honoured: anything else
 * (an absolute URL, a protocol-relative `//host`, junk) is dropped, so a
 * tampered stash can't navigate somewhere unexpected.
 */
const RETURN_PATH_PATTERN = /^\/(l|list)\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_\-/]*)?(\?[^#\s]*)?$/;

export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const path = raw.trim();
  return RETURN_PATH_PATTERN.test(path) ? path : null;
}
