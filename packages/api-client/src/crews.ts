// Crews API (onboarding spike #8) — group invite links. The preview endpoint is
// unauthenticated, so like `friends.ts` every response is zod-validated before
// it reaches the UI. The board carries full game + standings shapes, which are
// trusted like the rest of `/v1/games` (authenticated, same backend).

import type {
  CreateCrewResponse,
  CrewBoardResponse,
  CrewPreview,
  JoinCrewResponse,
  MyCrewsResponse,
} from "@workshop/shared/crews";
import { z } from "zod";
import { apiRequest } from "./api";

const personSchema = z.object({ userId: z.string(), displayName: z.string().nullable() });

const crewSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  token: z.string(),
  url: z.string(),
  memberCount: z.number(),
  createdBy: personSchema.nullable(),
  isCreator: z.boolean(),
  joinedAt: z.string(),
});

const crewPreviewSchema = z.object({
  crew: z.object({
    id: z.string(),
    name: z.string(),
    memberCount: z.number(),
    maxMembers: z.number(),
    creator: personSchema.nullable(),
    memberFirstNames: z.array(z.string()),
  }),
  viewer: z.object({ isMember: z.boolean() }).nullable(),
});

const joinCrewResponseSchema = z.object({
  crew: crewSummarySchema,
  alreadyMember: z.boolean(),
  friendshipsFormed: z.number(),
  friends: z.array(personSchema),
});

/** `POST /v1/crews` — create a crew; the response carries its share URL. */
export async function createCrew(name: string, token: string | null): Promise<CreateCrewResponse> {
  const raw = await apiRequest<unknown>({
    method: "POST",
    path: "/v1/crews",
    token,
    body: { name },
  });
  return z.object({ crew: crewSummarySchema }).parse(raw);
}

/** `GET /v1/crews/mine` — crews I'm in, newest-joined first. */
export async function fetchMyCrews(token: string | null): Promise<MyCrewsResponse> {
  const raw = await apiRequest<unknown>({ method: "GET", path: "/v1/crews/mine", token });
  return z.object({ crews: z.array(crewSummarySchema), limit: z.number() }).parse(raw);
}

/** `GET /v1/crews/:token` — public preview; works signed out. */
export async function fetchCrewPreview(
  crewToken: string,
  token: string | null,
): Promise<CrewPreview> {
  const raw = await apiRequest<unknown>({
    method: "GET",
    path: `/v1/crews/${encodeURIComponent(crewToken)}`,
    token,
  });
  return crewPreviewSchema.parse(raw);
}

/** `POST /v1/crews/:token/join` — join and befriend every member. */
export async function joinCrew(crewToken: string, token: string | null): Promise<JoinCrewResponse> {
  const raw = await apiRequest<unknown>({
    method: "POST",
    path: `/v1/crews/${encodeURIComponent(crewToken)}/join`,
    token,
  });
  return joinCrewResponseSchema.parse(raw);
}

/** `GET /v1/crews/:id/board?period=` — members + standings among them. */
export function fetchCrewBoard(
  crewId: string,
  periodKey: string,
  token: string | null,
): Promise<CrewBoardResponse> {
  return apiRequest<CrewBoardResponse>({
    method: "GET",
    path: `/v1/crews/${encodeURIComponent(crewId)}/board?period=${encodeURIComponent(periodKey)}`,
    token,
  });
}

/** `POST /v1/crews/:id/leave` — friendships formed through the crew stay. */
export function leaveCrew(crewId: string, token: string | null): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({
    method: "POST",
    path: `/v1/crews/${encodeURIComponent(crewId)}/leave`,
    token,
  });
}
