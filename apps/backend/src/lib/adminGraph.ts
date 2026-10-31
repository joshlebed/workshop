// The HighScore friend graph behind the admin "users web" dashboards
// (`GET /v1/admin/graph`). One node per HighScore user — anyone with a
// HighScore activity day, a game score, a game on their home screen, or a
// friendship edge — with per-user activity stats, plus every `friendships`
// row as an undirected edge. Everything is aggregated in JS from a handful of
// small per-user result sets; at this product's scale (dozens of users,
// thousands of scores) that's cheaper than a wide SQL join and runs the same
// against Postgres in prod and PGlite in tests.

import type { AdminGraphEdge, AdminGraphNode, AdminGraphResponse } from "@workshop/shared";
import { USER_FLAG_KEYS } from "@workshop/shared/constants";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import {
  friendRequests,
  friendships,
  gameScores,
  userActivityDays,
  userFlags,
  userGames,
  users,
} from "../db/schema.js";
import { isAdminUser } from "./admin.js";
import { utcDay } from "./userActivity.js";

const DAY_MS = 86_400_000;

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function num(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}

function bump<K>(map: Map<K, number>, key: K, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

export async function buildAdminGraph(now = new Date()): Promise<AdminGraphResponse> {
  const db = getDb();
  const since30 = utcDay(new Date(now.getTime() - 30 * DAY_MS));

  const [edgeRows, scoreRows, activityRows, homeRows, pendingRows, shareFlagRows] =
    await Promise.all([
      db
        .select({
          source: friendships.userLow,
          target: friendships.userHigh,
          createdAt: friendships.createdAt,
        })
        .from(friendships),
      db
        .select({
          userId: gameScores.userId,
          scoreCount: sql<number>`count(*)`,
          gamesScored: sql<number>`count(distinct ${gameScores.gameId})`,
          firstScoreAt: sql<string>`min(${gameScores.createdAt})`,
          lastScoreAt: sql<string>`max(${gameScores.createdAt})`,
        })
        .from(gameScores)
        .groupBy(gameScores.userId),
      db
        .select({
          userId: userActivityDays.userId,
          platform: userActivityDays.platform,
          day: userActivityDays.day,
        })
        .from(userActivityDays)
        .where(eq(userActivityDays.client, "highscore")),
      db
        .select({ userId: userGames.userId, count: sql<number>`count(*)` })
        .from(userGames)
        .groupBy(userGames.userId),
      db
        .select({ inviterId: friendRequests.inviterId, inviteeId: friendRequests.inviteeId })
        .from(friendRequests)
        .where(and(isNotNull(friendRequests.inviteeId), eq(friendRequests.status, "pending"))),
      db
        .select({ userId: userFlags.userId })
        .from(userFlags)
        .where(eq(userFlags.key, USER_FLAG_KEYS.shareExtensionScore)),
    ]);

  const friendCount = new Map<string, number>();
  const edges: AdminGraphEdge[] = edgeRows.map((e) => {
    bump(friendCount, e.source);
    bump(friendCount, e.target);
    return { source: e.source, target: e.target, createdAt: iso(e.createdAt) ?? "" };
  });

  const scores = new Map(scoreRows.map((r) => [r.userId, r]));
  const home = new Map(homeRows.map((r) => [r.userId, num(r.count)]));
  const pendingOut = new Map<string, number>();
  const pendingIn = new Map<string, number>();
  for (const p of pendingRows) {
    bump(pendingOut, p.inviterId);
    if (p.inviteeId) bump(pendingIn, p.inviteeId);
  }
  const shareUsers = new Set(shareFlagRows.map((r) => r.userId));

  const activity = new Map<
    string,
    { days: Set<string>; last: string | null; platforms: Set<string> }
  >();
  for (const row of activityRows) {
    const day = typeof row.day === "string" ? row.day : utcDay(new Date(row.day));
    let entry = activity.get(row.userId);
    if (!entry) {
      entry = { days: new Set(), last: null, platforms: new Set() };
      activity.set(row.userId, entry);
    }
    entry.days.add(day);
    if (entry.last === null || day > entry.last) entry.last = day;
    if (row.platform && row.platform !== "unknown") entry.platforms.add(row.platform);
  }

  const memberIds = new Set<string>([
    ...friendCount.keys(),
    ...scores.keys(),
    ...home.keys(),
    ...activity.keys(),
  ]);
  if (memberIds.size === 0) return { generatedAt: now.toISOString(), nodes: [], edges };

  const userRows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      createdAt: users.createdAt,
      avatarVersion: sql<string | null>`left(md5(${users.avatarUrl}), 8)`,
    })
    .from(users)
    .where(sql`${users.id} in ${[...memberIds]}`);

  const nodes: AdminGraphNode[] = userRows
    .map((u) => {
      const score = scores.get(u.id);
      const act = activity.get(u.id);
      const activeDays30 = act ? [...act.days].filter((d) => d >= since30).length : 0;
      return {
        id: u.id,
        displayName: u.displayName,
        email: u.email,
        avatarVersion: u.avatarVersion ?? null,
        isAdmin: isAdminUser(u),
        createdAt: iso(u.createdAt) ?? "",
        friendCount: friendCount.get(u.id) ?? 0,
        pendingOut: pendingOut.get(u.id) ?? 0,
        pendingIn: pendingIn.get(u.id) ?? 0,
        scoreCount: num(score?.scoreCount),
        gamesScored: num(score?.gamesScored),
        firstScoreAt: iso(score?.firstScoreAt),
        lastScoreAt: iso(score?.lastScoreAt),
        gamesOnHome: home.get(u.id) ?? 0,
        lastActiveDay: act?.last ?? null,
        activeDays30,
        activeDaysTotal: act?.days.size ?? 0,
        platforms: act ? [...act.platforms].sort() : [],
        usedShareExtension: shareUsers.has(u.id),
      };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  // Drop edges whose endpoints vanished between queries (deleted mid-flight).
  const nodeIds = new Set(nodes.map((n) => n.id));
  return {
    generatedAt: now.toISOString(),
    nodes,
    edges: edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)),
  };
}
