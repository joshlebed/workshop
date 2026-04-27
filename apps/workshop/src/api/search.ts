import type { BookSearchResponse, MediaSearchResponse, MediaSearchType } from "@workshop/shared";
import { apiRequest } from "../lib/api";

export function searchMedia(
  type: MediaSearchType,
  q: string,
  token: string | null,
  signal?: AbortSignal,
): Promise<MediaSearchResponse> {
  const params = new URLSearchParams({ type, q });
  return apiRequest<MediaSearchResponse>({
    method: "GET",
    path: `/v1/search/media?${params.toString()}`,
    token,
    signal,
  });
}

export function searchBooks(
  q: string,
  token: string | null,
  signal?: AbortSignal,
): Promise<BookSearchResponse> {
  const params = new URLSearchParams({ q });
  return apiRequest<BookSearchResponse>({
    method: "GET",
    path: `/v1/search/books?${params.toString()}`,
    token,
    signal,
  });
}
