import type { AuthResponse, Me } from "@workshop/shared";
import { ApiError } from "./apiError";

export interface BootstrapCredentials {
  accessToken: string | null;
  refreshToken: string | null;
  canRefresh: boolean;
}

interface BootstrapRequests {
  refresh: (refreshToken: string | null) => Promise<AuthResponse>;
  upgrade: (accessToken: string) => Promise<AuthResponse>;
  readLegacyMe: (accessToken: string) => Promise<Me>;
}

export type BootstrapResolution =
  | { kind: "authenticated"; response: AuthResponse }
  | { kind: "legacy"; me: Me; accessToken: string }
  | { kind: "signed-out" };

function hasStatus(error: unknown, ...statuses: number[]): boolean {
  return error instanceof ApiError && statuses.includes(error.status);
}

/**
 * Resolve stored credentials without mutating them. Only explicit 401/404
 * responses fall through to signed-out; transport, rate-limit, and server
 * failures reject so the caller can preserve credentials and render retry UI.
 */
export async function resolveBootstrapSession(
  credentials: BootstrapCredentials,
  requests: BootstrapRequests,
): Promise<BootstrapResolution> {
  if (credentials.canRefresh) {
    try {
      return { kind: "authenticated", response: await requests.refresh(credentials.refreshToken) };
    } catch (error) {
      if (hasStatus(error, 404) && !credentials.accessToken) throw error;
      if (!hasStatus(error, 401, 404)) throw error;
    }
  }

  const accessToken = credentials.accessToken;
  if (!accessToken) return { kind: "signed-out" };

  try {
    return { kind: "authenticated", response: await requests.upgrade(accessToken) };
  } catch (error) {
    if (hasStatus(error, 404)) {
      // New clients can briefly reach an old API during deploy. Verify the
      // legacy token without deleting it, then retry upgrade next launch.
      try {
        return { kind: "legacy", me: await requests.readLegacyMe(accessToken), accessToken };
      } catch (legacyError) {
        if (!hasStatus(legacyError, 401, 404)) throw legacyError;
        return { kind: "signed-out" };
      }
    }
    if (hasStatus(error, 401)) return { kind: "signed-out" };
    throw error;
  }
}
