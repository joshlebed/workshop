import type {
  ActivityFeedResponse,
  MarkActivityReadRequest,
  MarkActivityReadResponse,
} from "@workshop/shared";
import { apiRequest } from "../lib/api";

export interface FetchActivityArgs {
  cursor?: string;
  limit?: number;
}

export function fetchActivity(
  args: FetchActivityArgs,
  token: string | null,
): Promise<ActivityFeedResponse> {
  const params = new URLSearchParams();
  if (args.cursor) params.set("cursor", args.cursor);
  if (args.limit !== undefined) params.set("limit", String(args.limit));
  const qs = params.toString();
  const path = `/v1/activity${qs.length > 0 ? `?${qs}` : ""}`;
  return apiRequest<ActivityFeedResponse>({ method: "GET", path, token });
}

export function markActivityRead(
  body: MarkActivityReadRequest | undefined,
  token: string | null,
): Promise<MarkActivityReadResponse> {
  return apiRequest<MarkActivityReadResponse>({
    method: "POST",
    path: "/v1/activity/read",
    body: body ?? {},
    token,
  });
}
