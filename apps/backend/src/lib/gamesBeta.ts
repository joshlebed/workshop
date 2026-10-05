// The Games beta allowlist: features that are on in prod for a few named
// accounts before they are on for anyone else. One list for every such
// feature — game-score recognition today, the next teach flow after it — so
// "who is in the beta" has a single answer.
//
// Hardcoded on purpose. An env-var list would have to travel through
// Terraform, and these gates need to work on a deploy where it hasn't. IDs
// only: `users.id` is stable, and an email or name here would be PII in the
// repo. To add someone, add their `users.id` and deploy.

const GAMES_BETA_USER_IDS: ReadonlySet<string> = new Set([
  "b9a84203-b2c6-47a6-9fba-e41c2e10cffd", // Josh
  "a75a758c-e3cd-46a4-ae0e-7f4e67ea1c5e", // Dag
  "36d0153a-9db0-475c-8347-905628f6591a", // Paloma
]);

/**
 * Whether beta Games features are on for this account. Pass the user the
 * session acts as (`c.get("userId")`): during an admin impersonation that is
 * the impersonated account, so the admin sees exactly what that user sees —
 * the beta when impersonating a beta user, and not otherwise.
 */
export function isGamesBetaUser(userId: string): boolean {
  return GAMES_BETA_USER_IDS.has(userId);
}
