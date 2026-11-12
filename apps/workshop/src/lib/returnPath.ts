/**
 * Post-sign-in return path (UX pass 0.3, 4.1, 4.6).
 *
 * A share-link landing stashes where a signed-out visitor was (the short share
 * URL `/l/:slug`, the canonical `/list/:id`, or a legacy `/invite/:token`)
 * before sending them to sign in. AuthGate reads it once sign-in (and the
 * display-name step) completes and sends them back; the sign-in screen reads
 * it too, to show the list they are about to join. Only those three in-app
 * shapes are honoured: anything else (an absolute URL, a protocol-relative
 * `//host`, junk) is dropped, so a tampered stash can't navigate somewhere
 * unexpected.
 */
const RETURN_PATH_PATTERN = /^\/(l|list|invite)\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_\-/]*)?(\?[^#\s]*)?$/;

export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const path = raw.trim();
  return RETURN_PATH_PATTERN.test(path) ? path : null;
}

export type ReturnTarget =
  | { kind: "slug"; slug: string }
  | { kind: "list"; id: string }
  | { kind: "invite"; token: string };

/** Which list a (safe) return path points at, for the sign-in screen's preview. */
export function parseReturnPath(raw: string | null | undefined): ReturnTarget | null {
  const path = safeReturnPath(raw);
  if (!path) return null;
  const [, kind, key] = path.split("?")[0]?.split("/") ?? [];
  if (!key) return null;
  if (kind === "l") return { kind: "slug", slug: key };
  if (kind === "list") return { kind: "list", id: key };
  if (kind === "invite") return { kind: "invite", token: key };
  return null;
}

/**
 * Storage key for the return path. Set by `ListPublicLanding` when a
 * signed-out visitor taps sign in; read once (and cleared) by AuthGate.
 */
export const PENDING_RETURN_PATH_KEY = "workshop.pending-return-path";
