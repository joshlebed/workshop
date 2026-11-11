/**
 * Storage key for the most-recent share-link token a user clicked through.
 * Set by the accept-invite screen on mount so that a redirect through
 * `/sign-in` (and optionally `/onboarding/display-name`) can recover the
 * token after sign-in completes. Cleared by accept-invite once the
 * acceptance succeeds, errors, or the link is rejected.
 */
export const PENDING_INVITE_TOKEN_KEY = "workshop.pending-invite-token";
