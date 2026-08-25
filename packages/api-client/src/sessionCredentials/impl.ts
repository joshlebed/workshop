import type { AuthResponse } from "@workshop/shared";
import { getItem, removeItem, setItem } from "../storage";

const ACCESS_TOKEN_KEY = "workshop.session.v1";
const REFRESH_TOKEN_KEY = "workshop.refresh.v1";

export interface StoredSessionCredentials {
  accessToken: string | null;
  refreshToken: string | null;
  canRefresh: boolean;
}

export async function readSessionCredentials(): Promise<StoredSessionCredentials> {
  const [accessToken, refreshToken] = await Promise.all([
    getItem(ACCESS_TOKEN_KEY),
    getItem(REFRESH_TOKEN_KEY),
  ]);
  return { accessToken, refreshToken, canRefresh: refreshToken !== null };
}

export async function persistSessionCredentials(response: AuthResponse): Promise<void> {
  if (response.sessionMode !== "managed") {
    await setItem(ACCESS_TOKEN_KEY, response.token);
    return;
  }

  const refreshToken = response.refreshToken ?? (await getItem(REFRESH_TOKEN_KEY));
  if (!refreshToken) throw new Error("managed native session missing refresh token");
  await Promise.all([
    setItem(ACCESS_TOKEN_KEY, response.token),
    setItem(REFRESH_TOKEN_KEY, refreshToken),
  ]);
}

export async function clearSessionCredentials(): Promise<void> {
  await Promise.all([removeItem(ACCESS_TOKEN_KEY), removeItem(REFRESH_TOKEN_KEY)]);
}
