import { apiRequest } from "@workshop/api-client/api";
import type {
  ContactClientEvent,
  ContactMatchResponse,
  DiscoverabilityResponse,
} from "@workshop/shared/contacts";

/** `POST /v1/friends/contacts/match` — ≤500 digests, ≤5 calls/hour. Digests only. */
export function matchContactDigests(
  hashes: string[],
  surface: string,
  token: string | null,
): Promise<ContactMatchResponse> {
  return apiRequest<ContactMatchResponse>({
    method: "POST",
    path: "/v1/friends/contacts/match",
    body: { hashes, surface },
    token,
  });
}

export function fetchDiscoverability(token: string | null): Promise<DiscoverabilityResponse> {
  return apiRequest<DiscoverabilityResponse>({
    method: "GET",
    path: "/v1/users/me/discoverability",
    token,
  });
}

export function saveDiscoverability(
  email: boolean,
  token: string | null,
): Promise<DiscoverabilityResponse> {
  return apiRequest<DiscoverabilityResponse>({
    method: "PUT",
    path: "/v1/users/me/discoverability",
    body: { email },
    token,
  });
}

/** Funnel event for the contacts spike. Fire-and-forget: never affects the flow. */
export async function reportContactEvent(
  event: ContactClientEvent,
  token: string | null,
  extra: { count?: number; detail?: string; targetUserId?: string } = {},
): Promise<void> {
  try {
    await apiRequest<{ ok: boolean }>({
      method: "POST",
      path: "/v1/telemetry/contacts",
      body: { event, ...extra },
      token,
    });
  } catch {
    // Instrumentation must never affect the user-facing flow.
  }
}
