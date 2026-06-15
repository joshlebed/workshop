/**
 * Storage key for the most-recent share-link token a user clicked through.
 * Set by the accept-invite screen on mount so that a redirect through
 * `/sign-in` (and optionally `/onboarding/display-name`) can recover the
 * token after sign-in completes. Cleared by accept-invite once the
 * acceptance succeeds, errors, or the link is rejected.
 */
export const PENDING_INVITE_TOKEN_KEY = "workshop.pending-invite-token";

/**
 * Storage key for the most-recent *friend* invite token a user clicked through
 * (`/friends/accept/:token`, G2b). Mirrors `PENDING_INVITE_TOKEN_KEY` for the
 * games-surface friend graph so a brand-new user signing in mid-flow still
 * lands back on the accept screen. Set by the friend accept screen on mount,
 * consulted by AuthGate's post-sign-in bounce, cleared once acceptance
 * resolves (success or hard failure).
 */
export const PENDING_FRIEND_INVITE_TOKEN_KEY = "workshop.pending-friend-invite-token";

/**
 * Storage key for the most-recent *play link* token a user clicked through
 * (`/g/:token`, the Games-tab copy-scores CTA). Mirrors the friend-invite stash
 * so a signed-out recipient who signs in mid-flow lands back on the play-link
 * resolver, which then routes them (already-friends → Games home, otherwise →
 * the sharer's profile). Set by `app/g/[token].tsx` on mount, consulted by
 * AuthGate's post-sign-in bounce, cleared once the link resolves.
 */
export const PENDING_GAME_SHARE_TOKEN_KEY = "workshop.pending-game-share-token";
