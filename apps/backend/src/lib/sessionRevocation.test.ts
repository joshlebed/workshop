import { beforeEach, describe, expect, it, vi } from "vitest";

// Test-setup globally mocks this module so route tests can skip the DB;
// here we want the real implementation to verify its behavior.
vi.unmock("./sessionRevocation.js");

vi.mock("../db/client.js", () => ({
  getDb: vi.fn(),
}));

const { getDb } = await import("../db/client.js");
const { isSessionRevoked, revokeAllSessions } = await import("./sessionRevocation.js");

const ACTIVE_SESSION = {
  impersonatedUserId: null,
  idleExpiresAt: new Date(Date.now() + 60_000),
  absoluteExpiresAt: new Date(Date.now() + 120_000),
  revokedAt: null,
};

/** users row first, then the auth_sessions row — the order `isSessionRevoked` queries them. */
function buildManagedMocks(session: Record<string, unknown> | undefined) {
  const limit = vi
    .fn()
    .mockResolvedValueOnce([{ sessionsInvalidatedAt: null }])
    .mockResolvedValueOnce(session ? [session] : []);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set });
  vi.mocked(getDb).mockReturnValue({ select, update } as unknown as ReturnType<typeof getDb>);
  return { update, set };
}

function buildSelectMock(row: { sessionsInvalidatedAt: Date | null } | undefined) {
  const limit = vi.fn().mockResolvedValue(row ? [row] : []);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, limit };
}

describe("isSessionRevoked", () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReset();
  });

  it("returns false when the user has never revoked", async () => {
    const { select } = buildSelectMock({ sessionsInvalidatedAt: null });
    vi.mocked(getDb).mockReturnValue({ select } as unknown as ReturnType<typeof getDb>);
    expect(await isSessionRevoked("user-1", 1_700_000_000)).toBe(false);
  });

  it("returns false when iat is after the revocation cutoff", async () => {
    const cutoff = new Date(1_700_000_000_000); // ms
    const { select } = buildSelectMock({ sessionsInvalidatedAt: cutoff });
    vi.mocked(getDb).mockReturnValue({ select } as unknown as ReturnType<typeof getDb>);
    // iat (seconds) is one minute after cutoff
    expect(await isSessionRevoked("user-1", 1_700_000_060)).toBe(false);
  });

  it("returns true when iat is before the revocation cutoff", async () => {
    const cutoff = new Date(1_700_000_000_000);
    const { select } = buildSelectMock({ sessionsInvalidatedAt: cutoff });
    vi.mocked(getDb).mockReturnValue({ select } as unknown as ReturnType<typeof getDb>);
    // iat (seconds) is one minute before cutoff
    expect(await isSessionRevoked("user-1", 1_699_999_940)).toBe(true);
  });

  it("treats iat=0 (legacy token with no iat) as revoked once cutoff is set", async () => {
    const { select } = buildSelectMock({ sessionsInvalidatedAt: new Date() });
    vi.mocked(getDb).mockReturnValue({ select } as unknown as ReturnType<typeof getDb>);
    expect(await isSessionRevoked("user-1", 0)).toBe(true);
  });

  it("returns true for a non-existent user (deleted account)", async () => {
    const { select } = buildSelectMock(undefined);
    vi.mocked(getDb).mockReturnValue({ select } as unknown as ReturnType<typeof getDb>);
    expect(await isSessionRevoked("user-1", 1_700_000_000)).toBe(true);
  });
});

describe("isSessionRevoked (managed)", () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReset();
  });

  it("records the access token's refresh version the first time it is seen", async () => {
    const { update, set } = buildManagedMocks({ ...ACTIVE_SESSION, lastUsedRefreshVersion: 1 });
    expect(
      await isSessionRevoked("user-1", 1_700_000_000, {
        sessionId: "session-1",
        subjectUserId: "user-1",
        sessionVersion: 2,
      }),
    ).toBe(false);
    expect(update).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith({ lastUsedRefreshVersion: 2 });
  });

  it("stays read-only once the version is already recorded, or when the token has no version", async () => {
    const recorded = buildManagedMocks({ ...ACTIVE_SESSION, lastUsedRefreshVersion: 2 });
    expect(
      await isSessionRevoked("user-1", 1_700_000_000, {
        sessionId: "session-1",
        subjectUserId: "user-1",
        sessionVersion: 2,
      }),
    ).toBe(false);
    expect(recorded.update).not.toHaveBeenCalled();

    const legacy = buildManagedMocks({ ...ACTIVE_SESSION, lastUsedRefreshVersion: null });
    expect(
      await isSessionRevoked("user-1", 1_700_000_000, {
        sessionId: "session-1",
        subjectUserId: "user-1",
      }),
    ).toBe(false);
    expect(legacy.update).not.toHaveBeenCalled();
  });

  it("does not record use for a revoked or mismatched session", async () => {
    const revoked = buildManagedMocks({
      ...ACTIVE_SESSION,
      revokedAt: new Date(),
      lastUsedRefreshVersion: null,
    });
    expect(
      await isSessionRevoked("user-1", 1_700_000_000, {
        sessionId: "session-1",
        subjectUserId: "user-1",
        sessionVersion: 2,
      }),
    ).toBe(true);
    expect(revoked.update).not.toHaveBeenCalled();

    const mismatched = buildManagedMocks({
      ...ACTIVE_SESSION,
      impersonatedUserId: "someone-else",
      lastUsedRefreshVersion: null,
    });
    expect(
      await isSessionRevoked("user-1", 1_700_000_000, {
        sessionId: "session-1",
        subjectUserId: "user-1",
        sessionVersion: 2,
      }),
    ).toBe(true);
    expect(mismatched.update).not.toHaveBeenCalled();
  });
});

describe("revokeAllSessions", () => {
  it("revokes legacy and managed sessions in one transaction", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    const transaction = vi.fn(async (fn: (tx: { update: typeof update }) => Promise<void>) => {
      await fn({ update });
    });
    vi.mocked(getDb).mockReturnValue({ transaction } as unknown as ReturnType<typeof getDb>);
    await revokeAllSessions("user-1");
    expect(transaction).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenCalledWith({ sessionsInvalidatedAt: expect.any(Date) });
    expect(set).toHaveBeenCalledWith({ revokedAt: expect.any(Date) });
  });
});
