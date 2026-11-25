// Crews (onboarding spike #8, "density first") — one share link that makes
// everyone who joins friends with everyone already in it, plus a crew board.
// Exported via the `./crews` subpath. Runtime constants live here too; this
// module must not value-import a sibling (Metro can't resolve the `.js`
// specifiers — see root CLAUDE.md), so it only `import type`s.

import type { Game, GameStandingsEntry } from "./games.js";

/** Longest crew name, in characters (also the DB CHECK `crews_name_check`). */
export const CREW_NAME_MAX_LENGTH = 40;
/** Most people a crew can hold, creator included. */
export const CREW_MAX_MEMBERS = 25;
/** Most crews one person can be in (created or joined). */
export const CREW_MAX_PER_USER = 10;

export interface CrewPerson {
  userId: string;
  displayName: string | null;
}

/** A crew as its members see it (`GET /v1/crews/mine`, create, join). */
export interface CrewSummary {
  id: string;
  name: string;
  token: string;
  /** The shareable landing, `https://highscore.live/crew/:token`. */
  url: string;
  memberCount: number;
  /** Null when the creator deleted their account. */
  createdBy: CrewPerson | null;
  isCreator: boolean;
  /** When the viewer joined (ISO). */
  joinedAt: string;
}

/** `POST /v1/crews` */
export interface CreateCrewResponse {
  crew: CrewSummary;
}

/** `GET /v1/crews/mine` — newest-joined first. */
export interface MyCrewsResponse {
  crews: CrewSummary[];
  /** `CREW_MAX_PER_USER`, so the client can say when the cap is reached. */
  limit: number;
}

/**
 * `GET /v1/crews/:token` — the public preview the landing page and the OG card
 * read. No session needed; a signed-in caller also gets `viewer`.
 */
export interface CrewPreview {
  crew: {
    id: string;
    name: string;
    memberCount: number;
    maxMembers: number;
    creator: CrewPerson | null;
    /** First names of the earliest members (creator first), at most six. */
    memberFirstNames: string[];
  };
  viewer: { isMember: boolean } | null;
}

/** `POST /v1/crews/:token/join` */
export interface JoinCrewResponse {
  crew: CrewSummary;
  /** True when the caller was already in the crew (nothing changed). */
  alreadyMember: boolean;
  /** New `friendships` edges this join created. */
  friendshipsFormed: number;
  /** Crew members the caller is friends with now (excludes the caller). */
  friends: CrewPerson[];
}

/** One member row on the crew screen, viewer-relative. */
export interface CrewMember extends CrewPerson {
  avatarVersion: string | null;
  joinedAt: string;
  isViewer: boolean;
  isCreator: boolean;
  /** False for a member the viewer unfriended: their scores aren't shown. */
  isFriend: boolean;
}

/** One game on the crew board: today's standings among crew members. */
export interface CrewBoardGame {
  game: Game;
  /** Whether the viewer has this game on their home. */
  inMyGames: boolean;
  /** Ranked like the per-game board, crew members only. */
  entries: GameStandingsEntry[];
}

/** `GET /v1/crews/:id/board?period=` */
export interface CrewBoardResponse {
  crew: CrewSummary;
  members: CrewMember[];
  periodKey: string;
  /** Games any visible member posted to on `periodKey`, most players first. */
  games: CrewBoardGame[];
}
