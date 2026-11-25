// Crews (onboarding spike #8, "density first"): one link that makes everyone
// who joins friends with everyone already in it, plus a crew board of today's
// scores. Every rule lives here; `routes/v1/crews.ts` only parses requests.
//
// Join semantics:
//   - Joining forms a `friendships` edge with every current member through
//     `addFriendship` (the graph's only writer), except a pair blocked in
//     either direction (`blockedIdsFor`): they share the crew but get no edge,
//     so neither sees the other's scores (scores are friends-only).
//   - Re-joining is a no-op (`alreadyMember`) and never re-forms an edge the
//     viewer removed later.
//   - Caps: `CREW_MAX_MEMBERS` per crew (409 `crew_full`), `CREW_MAX_PER_USER`
//     crews per person, created or joined (409 `crew_limit`). The crew row is
//     locked while a join counts its members, so two last-seat joins can't
//     both land.
//   - A join consumes any pending directed request between the pair, like an
//     invite-link accept does.
//
// Instrumentation: `crew_members.friendships_formed` per join, `crews`
// created, the `crew created` / `crew joined` log lines, and the daily digest.

import {
  CREW_MAX_MEMBERS,
  CREW_MAX_PER_USER,
  CREW_NAME_MAX_LENGTH,
  type CrewBoardGame,
  type CrewBoardResponse,
  type CrewMember,
  type CrewPerson,
  type CrewPreview,
  type CrewSummary,
  type JoinCrewResponse,
} from "@workshop/shared/crews";
import { and, asc, count, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { withDbRetry } from "../db/retry.js";
import {
  crewMembers,
  crews,
  friendRequests,
  gameScores,
  games,
  userGames,
  users,
} from "../db/schema.js";
import { blockedIdsFor } from "./blocks.js";
import { getConfig } from "./config.js";
import { containsObjectionableContent } from "./contentFilter.js";
import { toIsoString } from "./dates.js";
import { addFriendship, friendsOf } from "./friends.js";
import { normalizeScoreDirection } from "./gameCatalog.js";
import { gameShapeColumns, toGameShape } from "./gameShapes.js";
import { loadStandingsByGame } from "./gameStandings.js";
import { avatarVersionSql } from "./images.js";
import { logger } from "./logger.js";
import { rankEntries } from "./ranking.js";
import { requestOriginColumns } from "./requestContext.js";
import { generateShareSlug } from "./shareSlug.js";

const CREW_BASE_URL = { local: "http://localhost:8081", production: "https://highscore.live" };
/** How many first names the public preview lists. */
const PREVIEW_NAMES = 6;

/** `https://highscore.live/crew/:token` (local: the HighScore dev port). */
function crewUrl(token: string, isLocal = getConfig().isLocal): string {
  return `${isLocal ? CREW_BASE_URL.local : CREW_BASE_URL.production}/crew/${token}`;
}

export type CrewNameResult =
  | { ok: true; name: string }
  | { ok: false; code: "CREW_NAME_INVALID" | "OBJECTIONABLE_CONTENT" };

/**
 * A crew name is trimmed, one line, 1–40 characters, and passes the content
 * filter (it is shown to strangers on the OG card).
 */
export function parseCrewName(raw: unknown): CrewNameResult {
  if (typeof raw !== "string") return { ok: false, code: "CREW_NAME_INVALID" };
  const name = raw.trim();
  if (name.length === 0 || /[\r\n]/.test(name)) return { ok: false, code: "CREW_NAME_INVALID" };
  // Code points, like the DB's char_length.
  if (Array.from(name).length > CREW_NAME_MAX_LENGTH)
    return { ok: false, code: "CREW_NAME_INVALID" };
  if (containsObjectionableContent(name)) return { ok: false, code: "OBJECTIONABLE_CONTENT" };
  return { ok: true, name };
}

/** First whitespace-delimited word of a display name. */
export function firstName(displayName: string | null): string | null {
  const first = displayName?.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : null;
}

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function membershipCount(db: Db | Tx, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(crewMembers)
    .where(eq(crewMembers.userId, userId));
  return row?.n ?? 0;
}

interface CrewRow {
  id: string;
  name: string;
  token: string;
  createdBy: string | null;
}

/** The viewer's summary of one crew they belong to. */
async function crewSummaryFor(crew: CrewRow, viewerId: string): Promise<CrewSummary | null> {
  const db = getDb();
  const [[mine], [size], creator] = await Promise.all([
    db
      .select({ joinedAt: crewMembers.joinedAt })
      .from(crewMembers)
      .where(and(eq(crewMembers.crewId, crew.id), eq(crewMembers.userId, viewerId)))
      .limit(1),
    db.select({ n: count() }).from(crewMembers).where(eq(crewMembers.crewId, crew.id)),
    crew.createdBy
      ? db
          .select({ userId: users.id, displayName: users.displayName })
          .from(users)
          .where(eq(users.id, crew.createdBy))
          .limit(1)
      : Promise.resolve([]),
  ]);
  if (!mine) return null;
  return {
    id: crew.id,
    name: crew.name,
    token: crew.token,
    url: crewUrl(crew.token),
    memberCount: size?.n ?? 0,
    createdBy: creator[0] ?? null,
    isCreator: crew.createdBy === viewerId,
    joinedAt: toIsoString(mine.joinedAt),
  };
}

export type CreateCrewResult = { kind: "ok"; crew: CrewSummary } | { kind: "limit" };

/** Create a crew with the caller as its first member. */
export async function createCrew(userId: string, name: string): Promise<CreateCrewResult> {
  const db = getDb();
  if ((await membershipCount(db, userId)) >= CREW_MAX_PER_USER) return { kind: "limit" };

  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generateShareSlug();
    const crew = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(crews)
        .values({ name, createdBy: userId, token })
        .onConflictDoNothing({ target: crews.token })
        .returning({
          id: crews.id,
          name: crews.name,
          token: crews.token,
          createdBy: crews.createdBy,
        });
      if (!inserted) return null;
      await tx
        .insert(crewMembers)
        .values({ crewId: inserted.id, userId, ...requestOriginColumns() });
      return inserted;
    });
    if (!crew) continue;
    logger.info("crew created", { crewId: crew.id, userId });
    const summary = await crewSummaryFor(crew, userId);
    if (summary) return { kind: "ok", crew: summary };
  }
  throw new Error("could not allocate a crew token");
}

/** Public preview by token. Null when no crew has this token. */
export async function previewCrew(
  token: string,
  viewerId: string | undefined,
): Promise<CrewPreview | null> {
  const db = getDb();
  // Unauthenticated path: the opening query rides out a Neon cold start.
  const [crew] = await withDbRetry(() =>
    db
      .select({ id: crews.id, name: crews.name, createdBy: crews.createdBy })
      .from(crews)
      .where(eq(crews.token, token))
      .limit(1),
  );
  if (!crew) return null;

  const members = await db
    .select({ userId: crewMembers.userId, displayName: users.displayName })
    .from(crewMembers)
    .innerJoin(users, eq(users.id, crewMembers.userId))
    .where(eq(crewMembers.crewId, crew.id))
    .orderBy(asc(crewMembers.joinedAt), asc(crewMembers.userId));

  const creatorRow = crew.createdBy ? members.find((m) => m.userId === crew.createdBy) : undefined;
  let creator: CrewPerson | null = creatorRow ?? null;
  if (!creator && crew.createdBy) {
    // A creator who left the crew is still its name on the card.
    const [row] = await db
      .select({ userId: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, crew.createdBy))
      .limit(1);
    creator = row ?? null;
  }

  const ordered = creatorRow
    ? [creatorRow, ...members.filter((m) => m.userId !== creatorRow.userId)]
    : members;
  const memberFirstNames = ordered
    .map((m) => firstName(m.displayName))
    .filter((n): n is string => n !== null)
    .slice(0, PREVIEW_NAMES);

  return {
    crew: {
      id: crew.id,
      name: crew.name,
      memberCount: members.length,
      maxMembers: CREW_MAX_MEMBERS,
      creator,
      memberFirstNames,
    },
    viewer: viewerId ? { isMember: members.some((m) => m.userId === viewerId) } : null,
  };
}

export type JoinCrewResult =
  | { kind: "ok"; response: JoinCrewResponse }
  | { kind: "not_found" }
  | { kind: "full" }
  | { kind: "limit" };

/** Join by token and befriend every current member (blocked pairs excepted). */
export async function joinCrew(userId: string, token: string): Promise<JoinCrewResult> {
  const db = getDb();
  type Seat =
    | { kind: "not_found" }
    | { kind: "full" }
    | { kind: "limit" }
    | { kind: "joined"; crew: CrewRow }
    | { kind: "member"; crew: CrewRow };
  const seat: Seat = await db.transaction(async (tx) => {
    const [crew] = await tx
      .select({ id: crews.id, name: crews.name, token: crews.token, createdBy: crews.createdBy })
      .from(crews)
      .where(eq(crews.token, token))
      .for("update")
      .limit(1);
    if (!crew) return { kind: "not_found" };
    const [existing] = await tx
      .select({ userId: crewMembers.userId })
      .from(crewMembers)
      .where(and(eq(crewMembers.crewId, crew.id), eq(crewMembers.userId, userId)))
      .limit(1);
    if (existing) return { kind: "member", crew };
    const [size] = await tx
      .select({ n: count() })
      .from(crewMembers)
      .where(eq(crewMembers.crewId, crew.id));
    if ((size?.n ?? 0) >= CREW_MAX_MEMBERS) return { kind: "full" };
    if ((await membershipCount(tx, userId)) >= CREW_MAX_PER_USER) return { kind: "limit" };
    await tx.insert(crewMembers).values({ crewId: crew.id, userId, ...requestOriginColumns() });
    return { kind: "joined", crew };
  });
  if (seat.kind === "not_found" || seat.kind === "full" || seat.kind === "limit") {
    return { kind: seat.kind };
  }

  const others = (
    await db
      .select({ userId: crewMembers.userId })
      .from(crewMembers)
      .where(and(eq(crewMembers.crewId, seat.crew.id), sql`${crewMembers.userId} <> ${userId}`))
  ).map((r) => r.userId);

  let friendshipsFormed = 0;
  let blockedSkipped = 0;
  if (seat.kind === "joined") {
    const blocked = await blockedIdsFor(userId);
    for (const otherId of others) {
      if (blocked.has(otherId)) {
        blockedSkipped += 1;
        continue;
      }
      if (await addFriendship(userId, otherId)) friendshipsFormed += 1;
    }
    const befriended = others.filter((id) => !blocked.has(id));
    if (befriended.length > 0) {
      // The crew satisfied any pending directed request between the pair.
      await db
        .delete(friendRequests)
        .where(
          and(
            eq(friendRequests.status, "pending"),
            isNotNull(friendRequests.inviteeId),
            or(
              and(
                eq(friendRequests.inviterId, userId),
                inArray(friendRequests.inviteeId, befriended),
              ),
              and(
                eq(friendRequests.inviteeId, userId),
                inArray(friendRequests.inviterId, befriended),
              ),
            ),
          ),
        );
    }
    await db
      .update(crewMembers)
      .set({ friendshipsFormed })
      .where(and(eq(crewMembers.crewId, seat.crew.id), eq(crewMembers.userId, userId)));
    logger.info("crew joined", {
      crewId: seat.crew.id,
      userId,
      memberCount: others.length + 1,
      friendshipsFormed,
      blockedSkipped,
    });
  }

  const myFriends = new Set(await friendsOf(userId));
  const friendIds = others.filter((id) => myFriends.has(id));
  const friendRows =
    friendIds.length === 0
      ? []
      : await db
          .select({ userId: users.id, displayName: users.displayName })
          .from(users)
          .where(inArray(users.id, friendIds));
  const summary = await crewSummaryFor(seat.crew, userId);
  if (!summary) throw new Error("crew membership vanished mid-join");
  return {
    kind: "ok",
    response: {
      crew: summary,
      alreadyMember: seat.kind === "member",
      friendshipsFormed,
      friends: friendRows,
    },
  };
}

/** Every crew the caller is in, newest-joined first. */
export async function listMyCrews(userId: string): Promise<CrewSummary[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: crews.id,
      name: crews.name,
      token: crews.token,
      createdBy: crews.createdBy,
      joinedAt: crewMembers.joinedAt,
      memberCount: sql<number>`(select count(*)::int from crew_members m where m.crew_id = ${crews.id})`,
      creatorName: users.displayName,
    })
    .from(crewMembers)
    .innerJoin(crews, eq(crews.id, crewMembers.crewId))
    .leftJoin(users, eq(users.id, crews.createdBy))
    .where(eq(crewMembers.userId, userId))
    .orderBy(desc(crewMembers.joinedAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    token: r.token,
    url: crewUrl(r.token),
    memberCount: Number(r.memberCount),
    createdBy: r.createdBy ? { userId: r.createdBy, displayName: r.creatorName } : null,
    isCreator: r.createdBy === userId,
    joinedAt: toIsoString(r.joinedAt),
  }));
}

/** Leave a crew. Friendships formed through it stay; an empty crew is deleted. */
export async function leaveCrew(userId: string, crewId: string): Promise<boolean> {
  const db = getDb();
  const removed = await db
    .delete(crewMembers)
    .where(and(eq(crewMembers.crewId, crewId), eq(crewMembers.userId, userId)))
    .returning({ crewId: crewMembers.crewId });
  if (removed.length === 0) return false;
  await db
    .delete(crews)
    .where(
      and(
        eq(crews.id, crewId),
        sql`not exists (select 1 from crew_members m where m.crew_id = ${crews.id})`,
      ),
    );
  logger.info("crew left", { crewId, userId });
  return true;
}

/**
 * The crew screen: members plus today's standings per game among them.
 * Null when the viewer isn't in the crew (the route 404s).
 *
 * Visibility follows the friend graph, never the crew: a member's scores show
 * only when the viewer is friends with them (`loadStandingsByGame` already
 * limits to `viewer ∪ friends`). In a crew everyone is friends by construction
 * except (a) a pair blocked in either direction — no edge was formed, and the
 * blocked member is also left out of `members` — and (b) a member the viewer
 * unfriended later, who stays listed with `isFriend: false` and no scores.
 */
export async function loadCrewBoard(
  viewerId: string,
  crewId: string,
  periodKey: string,
): Promise<CrewBoardResponse | null> {
  const db = getDb();
  const [crew] = await db
    .select({ id: crews.id, name: crews.name, token: crews.token, createdBy: crews.createdBy })
    .from(crews)
    .where(eq(crews.id, crewId))
    .limit(1);
  if (!crew) return null;
  const summary = await crewSummaryFor(crew, viewerId);
  if (!summary) return null;

  const [memberRows, blocked, friendIds] = await Promise.all([
    db
      .select({
        userId: crewMembers.userId,
        joinedAt: crewMembers.joinedAt,
        displayName: users.displayName,
        avatarVersion: avatarVersionSql,
      })
      .from(crewMembers)
      .innerJoin(users, eq(users.id, crewMembers.userId))
      .where(eq(crewMembers.crewId, crewId))
      .orderBy(asc(crewMembers.joinedAt), asc(crewMembers.userId)),
    blockedIdsFor(viewerId),
    friendsOf(viewerId),
  ]);
  const friends = new Set(friendIds);
  const members: CrewMember[] = memberRows
    .filter((m) => !blocked.has(m.userId))
    .map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      avatarVersion: m.avatarVersion,
      joinedAt: toIsoString(m.joinedAt),
      isViewer: m.userId === viewerId,
      isCreator: m.userId === crew.createdBy,
      isFriend: friends.has(m.userId),
    }));
  const visibleIds = members.filter((m) => m.isViewer || m.isFriend).map((m) => m.userId);
  const visible = new Set(visibleIds);

  const played = await db
    .select({ gameId: gameScores.gameId })
    .from(gameScores)
    .where(and(eq(gameScores.periodKey, periodKey), inArray(gameScores.userId, visibleIds)))
    .groupBy(gameScores.gameId);
  const gameIds = played.map((r) => r.gameId);

  let boardGames: CrewBoardGame[] = [];
  if (gameIds.length > 0) {
    const [gameRows, standings, mine] = await Promise.all([
      db.select(gameShapeColumns).from(games).where(inArray(games.id, gameIds)),
      loadStandingsByGame(viewerId, gameIds, periodKey),
      db
        .select({ gameId: userGames.gameId })
        .from(userGames)
        .where(and(eq(userGames.userId, viewerId), inArray(userGames.gameId, gameIds))),
    ]);
    const myGames = new Set(mine.map((r) => r.gameId));
    boardGames = gameRows
      .map((row) => ({
        game: toGameShape(row),
        inMyGames: myGames.has(row.id),
        entries: rankEntries(
          (standings.get(row.id) ?? []).filter((e) => visible.has(e.userId)),
          normalizeScoreDirection(row.scoreDirection),
        ),
      }))
      .filter((g) => g.entries.length > 0)
      .sort(
        (a, b) =>
          b.entries.length - a.entries.length ||
          Number(b.inMyGames) - Number(a.inMyGames) ||
          a.game.title.localeCompare(b.game.title),
      );
  }

  return { crew: summary, members, periodKey, games: boardGames };
}
