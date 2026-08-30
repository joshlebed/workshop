import { ApiError } from "@workshop/api-client/apiError";
import type { AuthImpersonation, DeleteAccountResponse } from "@workshop/shared";
import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_DELETION_CONSEQUENCES,
  AccountDeletionBlockedError,
  accountDeletionBlockReason,
  accountDeletionErrorMessage,
  nextDeletionStep,
  runAccountDeletion,
} from "./accountDeletion";

const IMPERSONATION: AuthImpersonation = {
  adminUserId: "admin-1",
  adminEmail: "admin@example.com",
  adminDisplayName: "Admin",
};

const SUCCESS: DeleteAccountResponse = {
  ok: true,
  deletedUserId: "user-1",
  providerRevocations: [{ provider: "apple", status: "revoked" }],
};

describe("accountDeletionBlockReason", () => {
  it("allows a normal signed-in session", () => {
    expect(accountDeletionBlockReason({ token: "t", impersonation: null })).toBeNull();
  });

  it("blocks while an admin is impersonating", () => {
    expect(accountDeletionBlockReason({ token: "t", impersonation: IMPERSONATION })).toBe(
      "impersonating",
    );
  });

  it("blocks a signed-out session", () => {
    expect(accountDeletionBlockReason({ token: null, impersonation: null })).toBe("signed-out");
  });
});

describe("ACCOUNT_DELETION_CONSEQUENCES", () => {
  it("states the shared Workshop.dev impact rather than hiding it", () => {
    const copy = ACCOUNT_DELETION_CONSEQUENCES.join(" ");
    expect(copy).toContain("Workshop.dev");
    expect(copy).toMatch(/cannot be undone/i);
    expect(copy).toMatch(/permanently deleted/i);
  });
});

describe("runAccountDeletion", () => {
  it("deletes, then clears credentials, and returns the server's report", async () => {
    const order: string[] = [];
    const requestDelete = vi.fn(async () => {
      order.push("request");
      return SUCCESS;
    });
    const clearSession = vi.fn(async () => {
      order.push("clear");
    });

    await expect(
      runAccountDeletion({ token: "t", impersonation: null, requestDelete, clearSession }),
    ).resolves.toEqual(SUCCESS);

    expect(requestDelete).toHaveBeenCalledWith("t");
    // Credentials are cleared only after the server confirmed the delete.
    expect(order).toEqual(["request", "clear"]);
  });

  it("keeps the session when the request fails — no false success", async () => {
    const clearSession = vi.fn();
    const requestDelete = vi.fn(async () => {
      throw new Error("Network request failed");
    });

    await expect(
      runAccountDeletion({ token: "t", impersonation: null, requestDelete, clearSession }),
    ).rejects.toThrow("Network request failed");
    expect(clearSession).not.toHaveBeenCalled();
  });

  it("keeps the session when the server returns an error", async () => {
    const clearSession = vi.fn();
    const requestDelete = vi.fn(async () => {
      throw Object.assign(new Error("internal error"), { status: 500 });
    });

    await expect(
      runAccountDeletion({ token: "t", impersonation: null, requestDelete, clearSession }),
    ).rejects.toThrow("internal error");
    expect(clearSession).not.toHaveBeenCalled();
  });

  it("never issues the request while impersonating", async () => {
    const requestDelete = vi.fn();
    const clearSession = vi.fn();

    await expect(
      runAccountDeletion({
        token: "t",
        impersonation: IMPERSONATION,
        requestDelete,
        clearSession,
      }),
    ).rejects.toBeInstanceOf(AccountDeletionBlockedError);
    expect(requestDelete).not.toHaveBeenCalled();
    expect(clearSession).not.toHaveBeenCalled();
  });

  it("never issues the request without a token", async () => {
    const requestDelete = vi.fn();
    const clearSession = vi.fn();

    await expect(
      runAccountDeletion({ token: null, impersonation: null, requestDelete, clearSession }),
    ).rejects.toMatchObject({ reason: "signed-out" });
    expect(requestDelete).not.toHaveBeenCalled();
    expect(clearSession).not.toHaveBeenCalled();
  });
});

describe("nextDeletionStep", () => {
  it("requires an explicit confirmation before the destructive action", () => {
    expect(nextDeletionStep("idle", "open")).toBe("confirming");
    expect(nextDeletionStep("idle", "submit")).toBe("idle");
    expect(nextDeletionStep("confirming", "submit")).toBe("deleting");
  });

  it("lets the user back out of the confirmation", () => {
    expect(nextDeletionStep("confirming", "cancel")).toBe("idle");
  });

  it("returns to the confirmation (not a signed-out state) after a failure", () => {
    expect(nextDeletionStep("deleting", "failed")).toBe("confirming");
  });

  it("ignores a cancel while the request is in flight", () => {
    expect(nextDeletionStep("deleting", "cancel")).toBe("deleting");
  });
});

describe("accountDeletionErrorMessage", () => {
  it("replaces a raw network failure with copy that says the account survived", () => {
    // "Failed to fetch" tells the user nothing about whether they still have
    // an account — which is the only thing they care about here.
    const message = accountDeletionErrorMessage(new TypeError("Failed to fetch"));
    expect(message).not.toContain("Failed to fetch");
    expect(message).toMatch(/try again/i);
  });

  it("lets a real server error speak for itself", () => {
    expect(accountDeletionErrorMessage(new ApiError("CONFLICT", "account is locked", 409))).toBe(
      "account is locked",
    );
  });

  it("surfaces the impersonation guard's own explanation", () => {
    expect(accountDeletionErrorMessage(new AccountDeletionBlockedError("impersonating"))).toMatch(
      /Stop impersonating/,
    );
  });
});
