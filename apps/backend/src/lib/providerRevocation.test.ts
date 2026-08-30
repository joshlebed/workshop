// Provider-revocation failure semantics. The contract under test: deletion is
// never blocked by a provider call, and every outcome is reported honestly —
// we never claim `revoked` for a call we didn't make or that failed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/client.js", () => ({ getDb: () => ({}) }));

import { resetConfigForTesting } from "./config.js";
import { type RevocableIdentity, revokeProviderTokens } from "./providerRevocation.js";
import { PROVIDER_REFRESH_TOKEN_PURPOSE, seal } from "./secretBox.js";

const CONTEXT = { userId: "00000000-0000-4000-8000-0000000000d1" };

// A real ES256 key so `createAppleClientSecret` succeeds without network.
const PRIVATE_KEY_HOLDER: { pem: string } = { pem: "" };

function configureApple(enabled: boolean) {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  process.env.APPLE_TEAM_ID = enabled ? "TEAM123456" : "";
  process.env.APPLE_KEY_ID = enabled ? "KEY1234567" : "";
  process.env.APPLE_PRIVATE_KEY = enabled ? PRIVATE_KEY_HOLDER.pem : "";
  resetConfigForTesting();
}

function appleIdentity(overrides: Partial<RevocableIdentity> = {}): RevocableIdentity {
  return {
    provider: "apple",
    providerSub: "apple-sub",
    providerClientId: "live.highscore.app",
    refreshTokenEncrypted: null,
    ...overrides,
  };
}

beforeEach(async () => {
  const { exportPKCS8, generateKeyPair } = await import("jose");
  const pair = await generateKeyPair("ES256", { extractable: true });
  PRIVATE_KEY_HOLDER.pem = await exportPKCS8(pair.privateKey);
  configureApple(true);
});

afterEach(() => vi.unstubAllGlobals());

describe("revokeProviderTokens", () => {
  it("reports nothing_to_revoke for Google — we never hold an offline token", async () => {
    const results = await revokeProviderTokens(
      [
        {
          provider: "google",
          providerSub: "g",
          providerClientId: null,
          refreshTokenEncrypted: null,
        },
      ],
      CONTEXT,
    );
    expect(results).toEqual([{ provider: "google", status: "nothing_to_revoke" }]);
  });

  it("reports nothing_to_revoke for an Apple identity with no stored token", async () => {
    const results = await revokeProviderTokens([appleIdentity()], CONTEXT);
    expect(results).toEqual([{ provider: "apple", status: "nothing_to_revoke" }]);
  });

  it("reports nothing_to_revoke when the stored token no longer decrypts", async () => {
    const results = await revokeProviderTokens(
      [appleIdentity({ refreshTokenEncrypted: "v1.aa.bb.cc" })],
      CONTEXT,
    );
    expect(results).toEqual([{ provider: "apple", status: "nothing_to_revoke" }]);
  });

  it("reports unavailable when the server's Apple credentials aren't configured", async () => {
    const sealed = seal(PROVIDER_REFRESH_TOKEN_PURPOSE, "rt-1");
    configureApple(false);
    const results = await revokeProviderTokens(
      [appleIdentity({ refreshTokenEncrypted: sealed })],
      CONTEXT,
    );
    expect(results).toEqual([{ provider: "apple", status: "unavailable" }]);
  });

  it("reports unavailable when we never recorded which Apple client minted it", async () => {
    const results = await revokeProviderTokens(
      [
        appleIdentity({
          providerClientId: null,
          refreshTokenEncrypted: seal(PROVIDER_REFRESH_TOKEN_PURPOSE, "rt-1"),
        }),
      ],
      CONTEXT,
    );
    expect(results).toEqual([{ provider: "apple", status: "unavailable" }]);
  });

  it("reports revoked when Apple accepts the call", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const results = await revokeProviderTokens(
      [appleIdentity({ refreshTokenEncrypted: seal(PROVIDER_REFRESH_TOKEN_PURPOSE, "rt-1") })],
      CONTEXT,
    );
    expect(results).toEqual([{ provider: "apple", status: "revoked" }]);
    expect(
      new URLSearchParams(
        (fetchMock.mock.calls[0] as never as [string, RequestInit])[1].body as string,
      ).get("token"),
    ).toBe("rt-1");
  });

  it("reports failed — and does not throw — when Apple is unreachable", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("ETIMEDOUT");
    });
    const results = await revokeProviderTokens(
      [appleIdentity({ refreshTokenEncrypted: seal(PROVIDER_REFRESH_TOKEN_PURPOSE, "rt-1") })],
      CONTEXT,
    );
    // Crucially: resolves. The account is already deleted; a provider outage
    // must never surface as a failed deletion.
    expect(results).toEqual([{ provider: "apple", status: "failed" }]);
  });

  it("reports each linked identity independently", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 500 }));
    const results = await revokeProviderTokens(
      [
        appleIdentity({ refreshTokenEncrypted: seal(PROVIDER_REFRESH_TOKEN_PURPOSE, "rt-1") }),
        {
          provider: "google",
          providerSub: "g",
          providerClientId: null,
          refreshTokenEncrypted: null,
        },
      ],
      CONTEXT,
    );
    expect(results).toEqual([
      { provider: "apple", status: "failed" },
      { provider: "google", status: "nothing_to_revoke" },
    ]);
  });
});
