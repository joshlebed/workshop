import type { ApiErrorResponse } from "@workshop/shared";
import { API_URL } from "../config";

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

interface ApiRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
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
  const headers: Record<string, string> = { "Content-Type": "application/json" };
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
