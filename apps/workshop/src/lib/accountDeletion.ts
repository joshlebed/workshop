/**
 * Account deletion rules for Workshop (UX pass 4.5, App Review 5.1.1(v)).
 * Mirrors HighScore's approach (`apps/highscore/src/lib/accountDeletion.ts`)
 * with Workshop's own copy; nothing is shared between the apps' UIs.
 *
 *  1. Credentials are cleared only after the server confirms the delete. An
 *     offline or 500 response leaves the session as it was.
 *  2. Deletion is blocked while an admin is impersonating (the backend also
 *     answers 403 `IMPERSONATION_ACTIVE`).
 *  3. The provider-revocation outcome is reported as the server gave it.
 *
 * Pure, so vitest drives it without a renderer.
 */
import { ApiError } from "@workshop/api-client/apiError";
import type {
  AuthImpersonation,
  DeleteAccountResponse,
  ProviderRevocationResult,
} from "@workshop/shared";

/** The word the person types to confirm. */
export const DELETE_CONFIRM_WORD = "delete";

/**
 * What deleting does, said plainly. Workshop and HighScore share one account
 * (one `users` row), so deleting here deletes there; the third line says so.
 * Matches `lib/accountDeletion.ts` on the backend: owned lists go for
 * everyone, and contributions to other people's lists go too.
 */
export const ACCOUNT_DELETION_CONSEQUENCES = [
  "Your name, photo and every list you own are deleted. Lists you own are deleted for everyone on them.",
  "On lists you joined, the items you added and your activity are deleted. The lists stay with their owners.",
  "This is the same account you use on HighScore. Your scores, friends and streaks there are deleted too.",
  "This can't be undone. Signing in again starts a new, empty account.",
] as const;

export type AccountDeletionBlockReason = "impersonating" | "signed-out";

export function accountDeletionBlockReason(state: {
  token: string | null;
  impersonation: AuthImpersonation | null;
}): AccountDeletionBlockReason | null {
  if (state.impersonation) return "impersonating";
  if (!state.token) return "signed-out";
  return null;
}

export function accountDeletionBlockMessage(reason: AccountDeletionBlockReason): string {
  return reason === "impersonating"
    ? "You're viewing someone else's account. Stop impersonating to delete an account."
    : "Sign in to delete your account.";
}

/** The typed confirmation matches, ignoring case and surrounding spaces. */
export function confirmationMatches(typed: string): boolean {
  return typed.trim().toLowerCase() === DELETE_CONFIRM_WORD;
}

export class AccountDeletionBlockedError extends Error {
  constructor(public readonly reason: AccountDeletionBlockReason) {
    super(accountDeletionBlockMessage(reason));
    this.name = "AccountDeletionBlockedError";
  }
}

export async function runAccountDeletion(deps: {
  token: string | null;
  impersonation: AuthImpersonation | null;
  requestDelete: (token: string) => Promise<DeleteAccountResponse>;
  clearSession: () => Promise<void>;
}): Promise<DeleteAccountResponse> {
  const blocked = accountDeletionBlockReason(deps);
  if (blocked) throw new AccountDeletionBlockedError(blocked);
  const response = await deps.requestDelete(deps.token as string);
  await deps.clearSession();
  return response;
}

export function accountDeletionErrorMessage(error: unknown): string {
  if (error instanceof AccountDeletionBlockedError) return error.message;
  if (error instanceof ApiError) {
    if (error.status === 403) return accountDeletionBlockMessage("impersonating");
    return "Couldn't delete your account. Nothing was deleted. Try again in a moment.";
  }
  return "Couldn't reach Workshop. Nothing was deleted. Check your connection and try again.";
}

/**
 * One honest line per provider about the sign-in access Workshop held.
 * `nothing_to_revoke` says nothing (Google never granted ongoing access).
 */
export function revocationLines(results: readonly ProviderRevocationResult[]): string[] {
  const lines: string[] = [];
  for (const r of results) {
    const name = r.provider === "apple" ? "Apple" : "Google";
    if (r.status === "revoked") {
      lines.push(`${name} confirmed that Workshop no longer has access to your ${name} sign-in.`);
    } else if (r.status === "unavailable" || r.status === "failed") {
      lines.push(
        name === "Apple"
          ? "Workshop couldn't remove itself from your Apple ID. You can do it in Settings, under your name, then Sign in with Apple."
          : `Workshop couldn't remove its ${name} sign-in access. You can do it from your ${name} account settings.`,
      );
    }
  }
  return lines;
}

// The outcome survives the sign-out that follows a delete, so the sign-in
// screen can say what happened. Memory only: a reload forgets it on purpose.
let lastDeletion: { lines: string[] } | null = null;

export function rememberDeletion(response: DeleteAccountResponse): void {
  lastDeletion = { lines: revocationLines(response.providerRevocations) };
}

export function takeDeletionNotice(): { lines: string[] } | null {
  const notice = lastDeletion;
  lastDeletion = null;
  return notice;
}
