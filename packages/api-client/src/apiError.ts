import type { ApiErrorResponse } from "@workshop/shared";

/**
 * Pure module — no react-native imports — so vitest can pull it in directly.
 * `apiRequest` lives next door in `./api.ts` (which imports `../config` and
 * thus react-native); helpers that work with `ApiError` instances should
 * import from here instead so their tests don't drag the whole app bundle
 * in.
 */

export class ApiError extends Error {
  readonly code: ApiErrorResponse["code"];
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ApiErrorResponse["code"], message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * `details.code` carried by an `ApiError`, when the server returned one. The
 * v1 envelope's `details` is `unknown`; routes use it to attach structured
 * error codes (e.g. `PLAYLIST_NOT_AVAILABLE`, `INVALID_PLAYLIST_URL`).
 */
export function apiErrorCode(error: unknown): string | undefined {
  if (error instanceof ApiError) {
    const details = error.details as { code?: unknown } | undefined;
    if (details && typeof details.code === "string") return details.code;
  }
  return undefined;
}

/**
 * Render a user-facing message for an unknown thrown value. Prefers
 * `Error.message` (already user-readable from the v1 envelope on `ApiError`),
 * then falls back to the supplied string.
 */
export function errorMessage(error: unknown, fallback = "Unknown error"): string {
  if (error instanceof Error) return error.message;
  return fallback;
}
