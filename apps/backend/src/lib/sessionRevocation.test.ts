import { beforeEach, describe, expect, it, vi } from "vitest";

// Test-setup globally mocks this module so route tests can skip the DB;
// here we want the real implementation to verify its behavior.
vi.unmock("./sessionRevocation.js");

vi.mock("../db/client.js", () => ({
  getDb: vi.fn(),
}));

const { getDb } = await import("../db/client.js");
const { isSessionRevoked, revokeAllSessions } = await import("./sessionRevocation.js");

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

describe("revokeAllSessions", () => {
  it("issues an UPDATE on the users row", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    vi.mocked(getDb).mockReturnValue({ update } as unknown as ReturnType<typeof getDb>);
    await revokeAllSessions("user-1");
    expect(update).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith({ sessionsInvalidatedAt: expect.any(Date) });
  });
});
