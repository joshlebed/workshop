import type { ApiErrorResponse } from "@workshop/shared";
import type { WorkshopClient } from "@workshop/shared/constants";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { ApiError } from "./apiError";
import { API_URL } from "./config";

const PLATFORM = Platform.OS;
const APP_VERSION = Constants.expoConfig?.version ?? "unknown";

export { ApiError, apiErrorCode, errorMessage } from "./apiError";

interface ApiRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
  /** Disable the one-shot managed-session refresh retry for auth bootstrap endpoints. */
  authRetry?: boolean;
}

type SessionRefreshHandler = (failedToken: string) => Promise<string | null>;

let sessionRefreshHandler: SessionRefreshHandler | null = null;
let refreshInFlight: Promise<string | null> | null = null;
let clientIdentity: WorkshopClient | null = null;

/** Configure the product identity included with every API request. */
export function configureApiClient({ client }: { client: WorkshopClient }): void {
  clientIdentity = client;
}

export function registerSessionRefreshHandler(handler: SessionRefreshHandler): () => void {
  sessionRefreshHandler = handler;
  return () => {
    if (sessionRefreshHandler === handler) sessionRefreshHandler = null;
  };
}

async function refreshAccessToken(failedToken: string): Promise<string | null> {
  if (!sessionRefreshHandler) return null;
  if (!refreshInFlight) {
    refreshInFlight = sessionRefreshHandler(failedToken).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

function isApiError(value: unknown): value is ApiErrorResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.error === "string" && typeof v.code === "string";
}

export async function apiRequest<T>({
  method,
  path,
  body,
  token,
  signal,
  authRetry = true,
}: ApiRequest): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Workshop-Platform": PLATFORM,
    "X-Workshop-App-Version": APP_VERSION,
    "X-Workshop-Session-Version": "2",
  };
  if (clientIdentity) headers["X-Workshop-Client"] = clientIdentity;
  if (token) headers.Authorization = `Bearer ${token}`;

  const init: RequestInit = { method, headers, credentials: "include" };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (signal) init.signal = signal;

  const res = await fetch(`${API_URL}${path}`, init);
  const text = await res.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : null;

  if (!res.ok) {
    if (res.status === 401 && token && authRetry) {
      const refreshedToken = await refreshAccessToken(token);
      if (refreshedToken) {
        return apiRequest<T>({
          method,
          path,
          body,
          token: refreshedToken,
          signal,
          authRetry: false,
        });
      }
    }
    if (isApiError(parsed)) {
      throw new ApiError(parsed.code, parsed.error, res.status, parsed.details);
    }
    throw new ApiError("INTERNAL", `http ${res.status}`, res.status);
  }
  return parsed as T;
}
