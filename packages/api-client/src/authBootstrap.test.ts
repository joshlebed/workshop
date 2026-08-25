import type { AuthResponse, Me } from "@workshop/shared";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./apiError";
import { resolveBootstrapSession } from "./authBootstrap";

const authResponse = { token: "managed", sessionMode: "managed" } as AuthResponse;
const me = { user: { id: "user-1" }, impersonation: null } as Me;

function requests(overrides: Partial<Parameters<typeof resolveBootstrapSession>[1]> = {}) {
  return {
    refresh: vi.fn(async () => authResponse),
    upgrade: vi.fn(async () => authResponse),
    readLegacyMe: vi.fn(async () => me),
    ...overrides,
  };
}

describe("resolveBootstrapSession", () => {
  it("prefers a managed refresh credential", async () => {
    const deps = requests();
    await expect(
      resolveBootstrapSession(
        { accessToken: "old", refreshToken: "refresh", canRefresh: true },
        deps,
      ),
    ).resolves.toEqual({ kind: "authenticated", response: authResponse });
    expect(deps.upgrade).not.toHaveBeenCalled();
  });

  it("upgrades a stored legacy bearer", async () => {
    await expect(
      resolveBootstrapSession(
        { accessToken: "legacy", refreshToken: null, canRefresh: false },
        requests(),
      ),
    ).resolves.toEqual({ kind: "authenticated", response: authResponse });
  });

  it("falls back to legacy me when the upgrade endpoint is not deployed yet", async () => {
    const deps = requests({
      upgrade: vi.fn(async () => {
        throw new ApiError("NOT_FOUND", "not found", 404);
      }),
    });
    await expect(
      resolveBootstrapSession(
        { accessToken: "legacy", refreshToken: null, canRefresh: false },
        deps,
      ),
    ).resolves.toEqual({ kind: "legacy", me, accessToken: "legacy" });
    expect(deps.readLegacyMe).toHaveBeenCalledWith("legacy");
  });

  it("returns signed-out only after an explicit auth rejection", async () => {
    const deps = requests({
      refresh: vi.fn(async () => {
        throw new ApiError("UNAUTHORIZED", "expired", 401);
      }),
      upgrade: vi.fn(async () => {
        throw new ApiError("UNAUTHORIZED", "expired", 401);
      }),
    });
    await expect(
      resolveBootstrapSession(
        { accessToken: "expired", refreshToken: "expired-refresh", canRefresh: true },
        deps,
      ),
    ).resolves.toEqual({ kind: "signed-out" });
  });

  it("preserves credentials by surfacing transient refresh failures", async () => {
    const unavailable = new ApiError("INTERNAL", "unavailable", 503);
    await expect(
      resolveBootstrapSession(
        { accessToken: "still-valid", refreshToken: "refresh", canRefresh: true },
        requests({ refresh: vi.fn(async () => Promise.reject(unavailable)) }),
      ),
    ).rejects.toBe(unavailable);
  });

  it("treats a missing refresh endpoint as rollout downtime when no bearer fallback exists", async () => {
    const notDeployed = new ApiError("NOT_FOUND", "not found", 404);
    await expect(
      resolveBootstrapSession(
        { accessToken: null, refreshToken: null, canRefresh: true },
        requests({ refresh: vi.fn(async () => Promise.reject(notDeployed)) }),
      ),
    ).rejects.toBe(notDeployed);
  });
});
