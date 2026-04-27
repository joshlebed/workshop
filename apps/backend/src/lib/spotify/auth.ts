import { createHash, randomBytes } from "node:crypto";
import { getConfig } from "../config.js";
import { SPOTIFY_SCOPE_STRING } from "./scopes.js";

const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

export interface SpotifyTokenResponse {
  access_token: string;
  token_type: "Bearer";
  scope: string;
  expires_in: number;
  refresh_token?: string;
}

function b64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Generate a cryptographically random PKCE verifier (43–128 chars per RFC 7636).
 * 64 bytes → 86 base64url characters, comfortably above the 43-char minimum.
 */
export function generateCodeVerifier(): string {
  return b64url(randomBytes(64));
}

export function generateState(): string {
  return b64url(randomBytes(24));
}

export function deriveCodeChallenge(verifier: string): string {
  return b64url(createHash("sha256").update(verifier).digest());
}

interface BuildAuthorizeUrlOptions {
  state: string;
  codeChallenge: string;
}

export function buildAuthorizeUrl({ state, codeChallenge }: BuildAuthorizeUrlOptions): string {
  const { spotifyClientId, spotifyRedirectUri } = getConfig();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: spotifyClientId,
    redirect_uri: spotifyRedirectUri,
    state,
    scope: SPOTIFY_SCOPE_STRING,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  });
  return `${SPOTIFY_AUTH_URL}?${params.toString()}`;
}

export class SpotifyAuthError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "SpotifyAuthError";
    this.cause = cause;
  }
}

async function postToken(body: URLSearchParams): Promise<SpotifyTokenResponse> {
  const { spotifyClientId, spotifyClientSecret } = getConfig();
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  // Confidential clients send Basic auth alongside PKCE; public clients skip
  // the secret. We support both — Spotify accepts either when PKCE is in use.
  if (spotifyClientSecret) {
    const basic = Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString("base64");
    headers.Authorization = `Basic ${basic}`;
  } else {
    body.set("client_id", spotifyClientId);
  }

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers,
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new SpotifyAuthError(`token endpoint ${res.status}: ${text}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SpotifyAuthError("invalid json from token endpoint");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { access_token?: unknown }).access_token !== "string"
  ) {
    throw new SpotifyAuthError("token response missing access_token");
  }
  return parsed as SpotifyTokenResponse;
}

export async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
): Promise<SpotifyTokenResponse> {
  const { spotifyRedirectUri } = getConfig();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: spotifyRedirectUri,
    code_verifier: codeVerifier,
  });
  return postToken(body);
}

export async function refreshAccessToken(refreshToken: string): Promise<SpotifyTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return postToken(body);
}
