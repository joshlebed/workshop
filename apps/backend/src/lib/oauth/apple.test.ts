import { generateKeyPair, type JWTVerifyGetKey, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { verifyAppleIdentityToken } from "./apple.js";
import { OAuthVerifyError } from "./jwks.js";

async function makeAppleToken(opts: {
  audience: string;
  sub?: string;
  nonce?: string;
  email?: string;
  expired?: boolean;
}): Promise<{ token: string; jwks: JWTVerifyGetKey }> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwks: JWTVerifyGetKey = async () => publicKey;
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = { sub: opts.sub ?? "apple-user-1" };
  if (opts.nonce !== undefined) payload.nonce = opts.nonce;
  if (opts.email !== undefined) payload.email = opts.email;
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "apple-test" })
    .setIssuer("https://appleid.apple.com")
    .setAudience(opts.audience)
    .setIssuedAt(now)
    .setExpirationTime(opts.expired ? now - 10 : now + 60)
    .sign(privateKey);
  return { token, jwks };
}

describe("verifyAppleIdentityToken", () => {
  it("accepts a valid token whose audience matches the iOS bundle id", async () => {
    const { token, jwks } = await makeAppleToken({
      audience: "dev.josh.workshop",
      email: "x@privaterelay.appleid.com",
    });
    const claims = await verifyAppleIdentityToken(
      { identityToken: token },
      { jwks, audiences: ["dev.josh.workshop", "dev.josh.workshop.web"] },
    );
    expect(claims.sub).toBe("apple-user-1");
    expect(claims.email).toBe("x@privaterelay.appleid.com");
  });

  it("accepts a valid token whose audience matches the web Services ID", async () => {
    const { token, jwks } = await makeAppleToken({ audience: "dev.josh.workshop.web" });
    const claims = await verifyAppleIdentityToken(
      { identityToken: token },
      { jwks, audiences: ["dev.josh.workshop", "dev.josh.workshop.web"] },
    );
    expect(claims.sub).toBe("apple-user-1");
  });

  it("rejects a token with no matching audience", async () => {
    const { token, jwks } = await makeAppleToken({ audience: "wrong-aud" });
    await expect(
      verifyAppleIdentityToken(
        { identityToken: token },
        { jwks, audiences: ["dev.josh.workshop"] },
      ),
    ).rejects.toBeInstanceOf(OAuthVerifyError);
  });

  it("rejects when the supplied nonce does not match the JWT's nonce", async () => {
    const { token, jwks } = await makeAppleToken({
      audience: "dev.josh.workshop",
      nonce: "real-nonce",
    });
    await expect(
      verifyAppleIdentityToken(
        { identityToken: token, nonce: "different" },
        { jwks, audiences: ["dev.josh.workshop"] },
      ),
    ).rejects.toBeInstanceOf(OAuthVerifyError);
  });

  it("accepts a matching nonce", async () => {
    const { token, jwks } = await makeAppleToken({
      audience: "dev.josh.workshop",
      nonce: "real-nonce",
    });
    const claims = await verifyAppleIdentityToken(
      { identityToken: token, nonce: "real-nonce" },
      { jwks, audiences: ["dev.josh.workshop"] },
    );
    expect(claims.nonce).toBe("real-nonce");
  });

  it("rejects an expired token", async () => {
    const { token, jwks } = await makeAppleToken({
      audience: "dev.josh.workshop",
      expired: true,
    });
    await expect(
      verifyAppleIdentityToken(
        { identityToken: token },
        { jwks, audiences: ["dev.josh.workshop"] },
      ),
    ).rejects.toBeInstanceOf(OAuthVerifyError);
  });

  it("throws when audiences are unconfigured", async () => {
    const { token, jwks } = await makeAppleToken({ audience: "dev.josh.workshop" });
    await expect(
      verifyAppleIdentityToken({ identityToken: token }, { jwks, audiences: [] }),
    ).rejects.toThrow("apple audiences not configured");
  });
});
