import { describe, expect, it, vi } from "vitest";

// Mock the module id the helper imports so the collector never follows the
// native `expo-secure-store` path (see CLAUDE.md).
const apiRequest = vi.fn();
vi.mock("@workshop/api-client/api", () => ({ apiRequest }));

const { requestAccountDeletion } = await import("./users");

describe("requestAccountDeletion", () => {
  it("issues a self-scoped DELETE with the caller's bearer token", async () => {
    apiRequest.mockResolvedValueOnce({ ok: true, deletedUserId: "u1", providerRevocations: [] });
    await requestAccountDeletion("token-1");
    expect(apiRequest).toHaveBeenCalledWith({
      method: "DELETE",
      // No target id anywhere in the path — the server derives the subject
      // from the token, so a client can't ask to delete someone else.
      path: "/v1/users/me",
      token: "token-1",
    });
  });

  it("propagates a failure instead of resolving", async () => {
    apiRequest.mockRejectedValueOnce(new Error("Network request failed"));
    await expect(requestAccountDeletion("token-1")).rejects.toThrow("Network request failed");
  });
});
