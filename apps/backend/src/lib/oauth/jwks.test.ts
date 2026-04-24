import { generateKeyPair, type JWTVerifyGetKey, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { OAuthVerifyError, verifyIdentityToken } from "./jwks.js";

interface KeyMaterial {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  jwks: JWTVerifyGetKey;
}

async function makeKey(): Promise<KeyMaterial> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  // jose's createRemoteJWKSet hits the network; for tests we just hand a
  // resolver that returns our public key directly.
  const jwks: JWTVerifyGetKey = async () => publicKey;
  return { privateKey, publicKey, jwks };
}

interface SignArgs {
  privateKey: CryptoKey;
  issuer: string;
  audience: string;
  sub: string;
  nonce?: string;
  expiresInSec?: number;
  extras?: Record<string, unknown>;
}

async function signTestToken(args: SignArgs): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    sub: args.sub,
    ...(args.extras ?? {}),
  };
  if (args.nonce !== undefined) payload.nonce = args.nonce;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(args.issuer)
    .setAudience(args.audience)
    .setIssuedAt(now)
    .setExpirationTime(now + (args.expiresInSec ?? 60))
    .sign(args.privateKey);
}

describe("verifyIdentityToken", () => {
  it("accepts a token signed by the matching JWKS with valid issuer + audience", async () => {
    const { privateKey, jwks } = await makeKey();
    const token = await signTestToken({
      privateKey,
      issuer: "https://example.com",
      audience: "aud-1",
      sub: "user-123",
      extras: { email: "a@b.test" },
    });
    const claims = await verifyIdentityToken(token, jwks, {
      issuer: "https://example.com",
      audience: ["aud-1"],
    });
    expect(claims.sub).toBe("user-123");
    expect(claims.email).toBe("a@b.test");
  });

  it("rejects a token whose audience is not in the allowlist", async () => {
    const { privateKey, jwks } = await makeKey();
    const token = await signTestToken({
      privateKey,
      issuer: "https://example.com",
      audience: "aud-other",
      sub: "user-123",
    });
    await expect(
      verifyIdentityToken(token, jwks, {
        issuer: "https://example.com",
        audience: ["aud-1", "aud-2"],
      }),
    ).rejects.toBeInstanceOf(OAuthVerifyError);
  });

  it("rejects a token whose issuer does not match", async () => {
    const { privateKey, jwks } = await makeKey();
    const token = await signTestToken({
      privateKey,
      issuer: "https://attacker.example",
      audience: "aud-1",
      sub: "user-123",
    });
    await expect(
      verifyIdentityToken(token, jwks, {
        issuer: "https://example.com",
        audience: ["aud-1"],
      }),
    ).rejects.toBeInstanceOf(OAuthVerifyError);
  });

  it("rejects a token signed by a different key", async () => {
    const { privateKey } = await makeKey();
    const { jwks: otherJwks } = await makeKey();
    const token = await signTestToken({
      privateKey,
      issuer: "https://example.com",
      audience: "aud-1",
      sub: "user-123",
    });
    await expect(
      verifyIdentityToken(token, otherJwks, {
        issuer: "https://example.com",
        audience: ["aud-1"],
      }),
    ).rejects.toBeInstanceOf(OAuthVerifyError);
  });

  it("rejects an expired token", async () => {
    const { privateKey, jwks } = await makeKey();
    const token = await signTestToken({
      privateKey,
      issuer: "https://example.com",
      audience: "aud-1",
      sub: "user-123",
      expiresInSec: -10,
    });
    await expect(
      verifyIdentityToken(token, jwks, {
        issuer: "https://example.com",
        audience: ["aud-1"],
      }),
    ).rejects.toBeInstanceOf(OAuthVerifyError);
  });

  it("rejects a nonce mismatch", async () => {
    const { privateKey, jwks } = await makeKey();
    const token = await signTestToken({
      privateKey,
      issuer: "https://example.com",
      audience: "aud-1",
      sub: "user-123",
      nonce: "abc",
    });
    await expect(
      verifyIdentityToken(token, jwks, {
        issuer: "https://example.com",
        audience: ["aud-1"],
        nonce: "different",
      }),
    ).rejects.toBeInstanceOf(OAuthVerifyError);
  });

  it("accepts a matching nonce", async () => {
    const { privateKey, jwks } = await makeKey();
    const token = await signTestToken({
      privateKey,
      issuer: "https://example.com",
      audience: "aud-1",
      sub: "user-123",
      nonce: "abc",
    });
    const claims = await verifyIdentityToken(token, jwks, {
      issuer: "https://example.com",
      audience: ["aud-1"],
      nonce: "abc",
    });
    expect(claims.nonce).toBe("abc");
  });

  it("rejects when no audiences are configured", async () => {
    // ensures the early-return path before any JWKS work runs.
    const { privateKey, jwks } = await makeKey();
    const token = await signTestToken({
      privateKey,
      issuer: "https://example.com",
      audience: "aud-1",
      sub: "user-123",
    });
    await expect(
      verifyIdentityToken(token, jwks, { issuer: "https://example.com", audience: [] }),
    ).rejects.toThrow("no audiences configured");
  });
});
