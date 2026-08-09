import type { AuthResponse } from "@workshop/shared";
import { getItem, removeItem, setItem } from "./storage";

const ACCESS_TOKEN_KEY = "workshop.session.v1";
const MANAGED_SESSION_KEY = "workshop.session.managed.v1";
const SIGNED_OUT_KEY = "workshop.session.signed-out.v1";

export interface StoredSessionCredentials {
  accessToken: string | null;
  refreshToken: null;
  canRefresh: boolean;
}

export async function readSessionCredentials(): Promise<StoredSessionCredentials> {
  const [accessToken, managedSession, signedOut] = await Promise.all([
    getItem(ACCESS_TOKEN_KEY),
    getItem(MANAGED_SESSION_KEY),
    getItem(SIGNED_OUT_KEY),
  ]);
  return {
    accessToken,
    refreshToken: null,
    canRefresh: managedSession === "1" && signedOut !== "1",
  };
}

export async function persistSessionCredentials(response: AuthResponse): Promise<void> {
  await removeItem(SIGNED_OUT_KEY);
  if (response.sessionMode === "managed") {
    // The refresh credential is an HttpOnly, same-origin cookie. Do not leave
    // the short-lived bearer token readable by browser JavaScript at rest.
    await Promise.all([removeItem(ACCESS_TOKEN_KEY), setItem(MANAGED_SESSION_KEY, "1")]);
    return;
  }
  await Promise.all([setItem(ACCESS_TOKEN_KEY, response.token), removeItem(MANAGED_SESSION_KEY)]);
}

export async function clearSessionCredentials(): Promise<void> {
  await Promise.all([
    removeItem(ACCESS_TOKEN_KEY),
    removeItem(MANAGED_SESSION_KEY),
    setItem(SIGNED_OUT_KEY, "1"),
  ]);
}
