import type { ApiErrorResponse } from "@workshop/shared";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { API_URL } from "../config";
import { ApiError } from "./apiError";

const PLATFORM = Platform.OS;
const APP_VERSION = Constants.expoConfig?.version ?? "unknown";

export { ApiError, apiErrorCode, errorMessage } from "./apiError";

interface ApiRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

function isApiError(value: unknown): value is ApiErrorResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.error === "string" && typeof v.code === "string";
}

export async function apiRequest<T>({ method, path, body, token, signal }: ApiRequest): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Workshop-Platform": PLATFORM,
    "X-Workshop-App-Version": APP_VERSION,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (signal) init.signal = signal;

  const res = await fetch(`${API_URL}${path}`, init);
  const text = await res.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : null;

  if (!res.ok) {
    if (isApiError(parsed)) {
      throw new ApiError(parsed.code, parsed.error, res.status, parsed.details);
    }
    throw new ApiError("INTERNAL", `http ${res.status}`, res.status);
  }
  return parsed as T;
}
