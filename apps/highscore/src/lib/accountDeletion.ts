// Client-side rules for permanent account deletion (App Store Review
// Guideline 5.1.1(v)). Kept out of the component and the auth context so the
// ordering guarantees below are unit-testable without a renderer.
//
// Two guarantees this module exists to enforce:
//
//  1. **Credentials are cleared only on a confirmed server success.** An
//     offline or 500 response leaves the session exactly as it was and the
//     error propagates — the UI must never show "account deleted" for a
//     request that didn't happen.
//  2. **Deletion is blocked while an admin is impersonating.** The account on
//     screen isn't the session owner's; deleting it would destroy someone
//     else's data from inside a support session. The backend enforces the same
//     rule (403 `IMPERSONATION_ACTIVE`); this is the local, immediate half.

// `./apiError` (not `./api`) — the pure error module, so this stays
// importable from a plain vitest run. See packages/api-client/src/apiError.ts.
import { ApiError, errorMessage } from "@workshop/api-client/apiError";
import type { AuthImpersonation, DeleteAccountResponse } from "@workshop/shared";

export type AccountDeletionBlockReason = "impersonating" | "signed-out";

export class AccountDeletionBlockedError extends Error {
  constructor(public readonly reason: AccountDeletionBlockReason) {
    super(
      reason === "impersonating"
        ? "Stop impersonating before deleting an account."
        : "You need to be signed in to delete your account.",
    );
    this.name = "AccountDeletionBlockedError";
  }
}

/**
 * Why the delete control must be inert right now, or null when it's allowed.
 * Drives both the disabled state and the explanation shown beside it.
 */
export function accountDeletionBlockReason(state: {
  token: string | null;
  impersonation: AuthImpersonation | null;
}): AccountDeletionBlockReason | null {
  if (state.impersonation) return "impersonating";
  if (!state.token) return "signed-out";
  return null;
}

/**
 * The consequences the confirmation must spell out before the destructive tap.
 *
 * The Workshop line is deliberate and not softened: Workshop.dev and HighScore
 * share one backend account (same `users` row, same Apple/Google identity), so
 * deleting here deletes there. Hiding that would make the confirmation a lie.
 */
export const ACCOUNT_DELETION_CONSEQUENCES = [
  "Your profile, scores, streaks, reactions and friends are permanently deleted.",
  "This is the same account you use on Workshop.dev — your lists, items and activity there are deleted too.",
  "Shared lists you own are deleted for everyone you shared them with.",
  "This cannot be undone, and signing in again creates a brand-new empty account.",
] as const;

/**
 * Confirmation state. Deletion is deliberately two-tap: `idle` shows the
 * destructive entry point, `confirming` shows the consequences beside the
 * real button, `deleting` is in-flight. A failed request drops back to
 * `confirming` (the account still exists, so the user can retry or cancel);
 * cancelling mid-flight is ignored, because the request can't be recalled.
 */
export type DeletionStep = "idle" | "confirming" | "deleting";
export type DeletionAction = "open" | "cancel" | "submit" | "failed";

export function nextDeletionStep(step: DeletionStep, action: DeletionAction): DeletionStep {
  switch (action) {
    case "open":
      return step === "idle" ? "confirming" : step;
    case "cancel":
      return step === "confirming" ? "idle" : step;
    case "submit":
      return step === "confirming" ? "deleting" : step;
    case "failed":
      return step === "deleting" ? "confirming" : step;
  }
}

export interface RunAccountDeletionDeps {
  token: string | null;
  impersonation: AuthImpersonation | null;
  /** Issues `DELETE /v1/users/me`. Must reject on any non-2xx or network error. */
  requestDelete: (token: string) => Promise<DeleteAccountResponse>;
  /** Wipes stored access/refresh credentials. Only called after a real success. */
  clearSession: () => Promise<void>;
}

/**
 * Run the deletion. Resolves with the server's response (after credentials are
 * cleared) or rejects — `AccountDeletionBlockedError` when it was never
 * attempted, otherwise whatever the request threw.
 */
export async function runAccountDeletion(
  deps: RunAccountDeletionDeps,
): Promise<DeleteAccountResponse> {
  const blocked = accountDeletionBlockReason(deps);
  if (blocked) throw new AccountDeletionBlockedError(blocked);
  // `accountDeletionBlockReason` already proved the token is non-null.
  const response = await deps.requestDelete(deps.token as string);
  await deps.clearSession();
  return response;
}

/**
 * User-facing copy for a failed deletion. A raw network `TypeError` reads as
 * "Failed to fetch", which tells the user nothing about the one thing they
 * need to know: the account still exists and they can try again. Only a real
 * server response gets to speak for itself.
 */
export function accountDeletionErrorMessage(error: unknown): string {
  if (error instanceof AccountDeletionBlockedError) return error.message;
  if (error instanceof ApiError) {
    return errorMessage(error, "Could not delete your account. Please try again.");
  }
  return "Could not delete your account. Check your connection and try again.";
}
