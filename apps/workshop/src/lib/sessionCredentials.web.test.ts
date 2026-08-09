import type { AuthResponse } from "@workshop/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const values = new Map<string, string>();

vi.mock("./storage", () => ({
  getItem: vi.fn(async (key: string) => values.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => {
    values.set(key, value);
  }),
  removeItem: vi.fn(async (key: string) => {
    values.delete(key);
  }),
}));

const { clearSessionCredentials, persistSessionCredentials, readSessionCredentials } = await import(
  "./sessionCredentials.web"
);

const managedResponse = {
  token: "short-access",
  sessionMode: "managed",
} as AuthResponse;

describe("web session credentials", () => {
  beforeEach(() => values.clear());

  it("does not probe refresh for a visitor with no managed-session marker", async () => {
    await expect(readSessionCredentials()).resolves.toEqual({
      accessToken: null,
      refreshToken: null,
      canRefresh: false,
    });
  });

  it("stores only a non-sensitive presence marker for a managed session", async () => {
    await persistSessionCredentials(managedResponse);
    expect(values.has("workshop.session.v1")).toBe(false);
    expect(values.get("workshop.session.managed.v1")).toBe("1");
    expect((await readSessionCredentials()).canRefresh).toBe(true);
  });

  it("records an explicit local signout and suppresses a stale cookie", async () => {
    await persistSessionCredentials(managedResponse);
    await clearSessionCredentials();
    expect(values.get("workshop.session.signed-out.v1")).toBe("1");
    expect((await readSessionCredentials()).canRefresh).toBe(false);
  });
});
