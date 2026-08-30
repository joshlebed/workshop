import { exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../config.js";
import {
  AppleTokenError,
  appleTokenApiConfigured,
  createAppleClientSecret,
  exchangeAppleAuthorizationCode,
  revokeAppleToken,
} from "./appleTokens.js";

let privateKeyPem: string;
let publicKey: CryptoKey;

function configure(opts: { teamId?: string; keyId?: string; privateKey?: string } = {}) {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  process.env.APPLE_TEAM_ID = opts.teamId ?? "TEAM123456";
  process.env.APPLE_KEY_ID = opts.keyId ?? "KEY1234567";
  process.env.APPLE_PRIVATE_KEY = opts.privateKey ?? privateKeyPem;
  resetConfigForTesting();
}

function unconfigure() {
  process.env.APPLE_TEAM_ID = "";
  process.env.APPLE_KEY_ID = "";
  process.env.APPLE_PRIVATE_KEY = "";
  resetConfigForTesting();
}

beforeEach(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  privateKeyPem = await exportPKCS8(pair.privateKey);
  publicKey = pair.publicKey as CryptoKey;
  configure();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("appleTokenApiConfigured", () => {
  it("is false unless all three credentials are present", () => {
    expect(appleTokenApiConfigured()).toBe(true);
    configure({ teamId: "" });
    expect(appleTokenApiConfigured()).toBe(false);
    configure({ keyId: "" });
    expect(appleTokenApiConfigured()).toBe(false);
    configure({ privateKey: "" });
    expect(appleTokenApiConfigured()).toBe(false);
  });
});

describe("createAppleClientSecret", () => {
  it("signs an ES256 JWT with the claims Apple requires", async () => {
    const secret = await createAppleClientSecret("live.highscore.app");
    const { payload, protectedHeader } = await jwtVerify(secret, publicKey, {
      issuer: "TEAM123456",
      audience: "https://appleid.apple.com",
    });
    expect(protectedHeader).toMatchObject({ alg: "ES256", kid: "KEY1234567" });
    expect(payload.sub).toBe("live.highscore.app");
    expect(payload.exp).toBeGreaterThan(payload.iat ?? 0);
  });

  it("accepts a private key whose newlines were escaped for the env var", async () => {
    configure({ privateKey: privateKeyPem.replace(/\n/g, "\\n") });
    await expect(createAppleClientSecret("dev.josh.workshop")).resolves.toBeTypeOf("string");
  });

  it("throws rather than silently skipping when unconfigured", async () => {
    unconfigure();
    await expect(createAppleClientSecret("x")).rejects.toBeInstanceOf(AppleTokenError);
  });

  it("throws when the private key can't be parsed", async () => {
    configure({ privateKey: "-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----" });
    await expect(createAppleClientSecret("x")).rejects.toBeInstanceOf(AppleTokenError);
  });
});

describe("exchangeAppleAuthorizationCode", () => {
  it("posts the form Apple expects and returns the refresh token", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ refresh_token: "rt-1" })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      exchangeAppleAuthorizationCode({ code: "code-1", clientId: "live.highscore.app" }),
    ).resolves.toBe("rt-1");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://appleid.apple.com/auth/token");
    const form = new URLSearchParams(init.body as string);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("code-1");
    expect(form.get("client_id")).toBe("live.highscore.app");
    expect(form.get("client_secret")).toBeTruthy();
  });

  it("returns null when Apple issues no refresh token", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ access_token: "at" })));
    await expect(exchangeAppleAuthorizationCode({ code: "c", clientId: "id" })).resolves.toBeNull();
  });

  it("throws on a non-2xx so the caller can't record a phantom token", async () => {
    vi.stubGlobal("fetch", async () => new Response("bad", { status: 400 }));
    await expect(exchangeAppleAuthorizationCode({ code: "c", clientId: "id" })).rejects.toThrow(
      /400/,
    );
  });
});

describe("revokeAppleToken", () => {
  it("posts the token with the refresh_token hint", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await revokeAppleToken({ token: "rt-1", clientId: "live.highscore.app" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://appleid.apple.com/auth/revoke");
    const form = new URLSearchParams(init.body as string);
    expect(form.get("token")).toBe("rt-1");
    expect(form.get("token_type_hint")).toBe("refresh_token");
    expect(form.get("client_id")).toBe("live.highscore.app");
  });

  it("throws when Apple rejects the revoke", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 401 }));
    await expect(revokeAppleToken({ token: "t", clientId: "id" })).rejects.toBeInstanceOf(
      AppleTokenError,
    );
  });

  it("throws when the network call fails outright", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNRESET");
    });
    await expect(revokeAppleToken({ token: "t", clientId: "id" })).rejects.toBeInstanceOf(
      AppleTokenError,
    );
  });
});
