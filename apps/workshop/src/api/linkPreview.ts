import { apiRequest } from "@workshop/api-client/api";
import type { LinkPreviewResponse } from "@workshop/shared";

export function fetchLinkPreview(
  url: string,
  token: string | null,
  signal?: AbortSignal,
): Promise<LinkPreviewResponse> {
  const params = new URLSearchParams({ url });
  return apiRequest<LinkPreviewResponse>({
    method: "GET",
    path: `/v1/link-preview?${params.toString()}`,
    token,
    signal,
  });
}
