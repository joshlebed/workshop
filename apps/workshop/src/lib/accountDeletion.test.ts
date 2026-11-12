import { ApiError } from "@workshop/api-client/apiError";
import type { DeleteAccountResponse } from "@workshop/shared";
import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_DELETION_CONSEQUENCES,
  AccountDeletionBlockedError,
  accountDeletionBlockReason,
  accountDeletionErrorMessage,
  confirmationMatches,
  rememberDeletion,
  revocationLines,
  runAccountDeletion,
  takeDeletionNotice,
} from "./accountDeletion";

const ok: DeleteAccountResponse = {
  ok: true,
  deletedUserId: "u1",
  providerRevocations: [{ provider: "apple", status: "revoked" }],
};
const impersonation = { adminUserId: "a", adminDisplayName: "Admin" } as never;

describe("account deletion (4.5)", () => {
  it("says the account is shared with HighScore and what happens to owned lists", () => {
    const text = ACCOUNT_DELETION_CONSEQUENCES.join(" ");
    expect(text).toMatch(/HighScore/);
    expect(text).toMatch(/Lists you own are deleted for everyone on them/);
    expect(text).toMatch(/can't be undone/);
  });

  it("needs the typed word", () => {
    expect(confirmationMatches(" Delete ")).toBe(true);
    expect(confirmationMatches("del")).toBe(false);
  });

  it("is blocked while impersonating, before any request", async () => {
    expect(accountDeletionBlockReason({ token: "t", impersonation })).toBe("impersonating");
    const requestDelete = vi.fn();
    await expect(
      runAccountDeletion({ token: "t", impersonation, requestDelete, clearSession: vi.fn() }),
    ).rejects.toBeInstanceOf(AccountDeletionBlockedError);
    expect(requestDelete).not.toHaveBeenCalled();
  });

  it("clears the session only after the server confirms", async () => {
    const clearSession = vi.fn();
    await expect(
      runAccountDeletion({
        token: "t",
        impersonation: null,
        requestDelete: () => Promise.reject(new TypeError("Failed to fetch")),
        clearSession,
      }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(clearSession).not.toHaveBeenCalled();

    const res = await runAccountDeletion({
      token: "t",
      impersonation: null,
      requestDelete: () => Promise.resolve(ok),
      clearSession,
    });
    expect(res).toBe(ok);
    expect(clearSession).toHaveBeenCalledOnce();
  });

  it("explains failures plainly, and says nothing was deleted", () => {
    expect(accountDeletionErrorMessage(new TypeError("x"))).toMatch(/Nothing was deleted/);
    expect(accountDeletionErrorMessage(new ApiError("INTERNAL", "boom", 500))).toMatch(
      /Nothing was deleted/,
    );
    expect(
      accountDeletionErrorMessage(new ApiError("FORBIDDEN", "IMPERSONATION_ACTIVE", 403)),
    ).toMatch(/impersonating/);
  });

  it("reports each provider outcome honestly", () => {
    expect(revocationLines([{ provider: "apple", status: "revoked" }])[0]).toMatch(/confirmed/);
    expect(revocationLines([{ provider: "apple", status: "unavailable" }])[0]).toMatch(
      /couldn't remove itself from your Apple ID/,
    );
    expect(revocationLines([{ provider: "apple", status: "failed" }])).toHaveLength(1);
    expect(revocationLines([{ provider: "google", status: "nothing_to_revoke" }])).toEqual([]);
  });

  it("hands the outcome to the sign-in screen once", () => {
    rememberDeletion(ok);
    expect(takeDeletionNotice()?.lines).toHaveLength(1);
    expect(takeDeletionNotice()).toBeNull();
  });
});
