/** Recover a friend-invite route after a sign-in or onboarding round trip. */
export const PENDING_FRIEND_INVITE_TOKEN_KEY = "workshop.pending-friend-invite-token";

/** Recover a game-share resolver route after a sign-in or onboarding round trip. */
export const PENDING_GAME_SHARE_TOKEN_KEY = "workshop.pending-game-share-token";

/**
 * Who invited a signed-out visitor (`PreloginInviteContext` JSON), so the
 * sign-in screen can say "Josh invited you" instead of a context-free wall.
 * Only read while the matching pending token above is still stashed.
 */
export const PENDING_INVITE_CONTEXT_KEY = "workshop.pending-invite-context";

/**
 * A score pasted on an invite landing before sign-in (`PreloginScoreDraft`
 * JSON). Never sent anywhere until the visitor signs in; then the landing
 * posts it with the normal authenticated upsert and clears it.
 */
export const PRELOGIN_SCORE_DRAFT_KEY = "workshop.prelogin-score-draft";
