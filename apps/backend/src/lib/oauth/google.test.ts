import { generateKeyPair, type JWTVerifyGetKey, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { verifyGoogleIdentityToken } from "./google.js";
import { OAuthVerifyError } from "./jwks.js";

async function makeGoogleToken(opts: {
  audience: string;
  issuer?: string;
  sub?: string;
  email?: string;
  name?: string;
  expired?: boolean;
}): Promise<{ token: string; jwks: JWTVerifyGetKey }> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwks: JWTVerifyGetKey = async () => publicKey;
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = { sub: opts.sub ?? "google-user-1" };
  if (opts.email !== undefined) payload.email = opts.email;
  if (opts.name !== undefined) payload.name = opts.name;
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "google-test" })
    .setIssuer(opts.issuer ?? "https://accounts.google.com")
    .setAudience(opts.audience)
    .setIssuedAt(now)
    .setExpirationTime(opts.expired ? now - 10 : now + 60)
    .sign(privateKey);
  return { token, jwks };
}

describe("verifyGoogleIdentityToken", () => {
  it("accepts a valid token with the https issuer", async () => {
    const { token, jwks } = await makeGoogleToken({
      audience: "ios.client.id",
      email: "user@example.com",
      name: "Real Name",
    });
    const claims = await verifyGoogleIdentityToken(
      { idToken: token },
      { jwks, audiences: ["ios.client.id", "web.client.id"] },
    );
    expect(claims.sub).toBe("google-user-1");
    expect(claims.email).toBe("user@example.com");
    expect(claims.name).toBe("Real Name");
  });

  it("accepts a valid token with the bare 'accounts.google.com' issuer", async () => {
    const { token, jwks } = await makeGoogleToken({
      audience: "ios.client.id",
      issuer: "accounts.google.com",
    });
    const claims = await verifyGoogleIdentityToken(
      { idToken: token },
      { jwks, audiences: ["ios.client.id"] },
    );
    expect(claims.sub).toBe("google-user-1");
  });

  it("rejects a token with a foreign issuer", async () => {
    const { token, jwks } = await makeGoogleToken({
      audience: "ios.client.id",
      issuer: "https://attacker.example",
    });
    await expect(
      verifyGoogleIdentityToken({ idToken: token }, { jwks, audiences: ["ios.client.id"] }),
    ).rejects.toBeInstanceOf(OAuthVerifyError);
  });

  it("rejects a token whose audience does not match any configured client id", async () => {
    const { token, jwks } = await makeGoogleToken({ audience: "rogue.client.id" });
    await expect(
      verifyGoogleIdentityToken(
        { idToken: token },
        { jwks, audiences: ["ios.client.id", "web.client.id"] },
      ),
    ).rejects.toBeInstanceOf(OAuthVerifyError);
  });

  it("throws when audiences are unconfigured", async () => {
    const { token, jwks } = await makeGoogleToken({ audience: "ios.client.id" });
    await expect(
      verifyGoogleIdentityToken({ idToken: token }, { jwks, audiences: [] }),
    ).rejects.toThrow("google audiences not configured");
  });
});
