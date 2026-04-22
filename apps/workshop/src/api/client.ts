import type {
  CreateWatchlistItemBody,
  RequestMagicLinkBody,
  RequestMagicLinkResponse,
  UpdateWatchlistItemBody,
  VerifyMagicLinkBody,
  VerifyMagicLinkResponse,
  WatchlistItem,
} from "@workshop/shared";
import { API_URL } from "../config";
import { loadSession } from "../lib/storage";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: { auth?: boolean } = { auth: true },
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.auth !== false) {
    const token = await loadSession();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = payload?.error ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return payload as T;
}

export const api = {
  requestMagicLink: (body: RequestMagicLinkBody) =>
    request<RequestMagicLinkResponse>("POST", "/auth/request", body, { auth: false }),
  verifyMagicLink: (body: VerifyMagicLinkBody) =>
    request<VerifyMagicLinkResponse>("POST", "/auth/verify", body, { auth: false }),
  listWatchlist: () => request<{ items: WatchlistItem[] }>("GET", "/watchlist"),
  createItem: (body: CreateWatchlistItemBody) => request<WatchlistItem>("POST", "/watchlist", body),
  updateItem: (id: string, body: UpdateWatchlistItemBody) =>
    request<WatchlistItem>("PATCH", `/watchlist/${id}`, body),
  deleteItem: (id: string) => request<{ ok: true }>("DELETE", `/watchlist/${id}`),
};

export { ApiError };
