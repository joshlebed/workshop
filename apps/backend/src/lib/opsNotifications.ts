// Operator-channel (#workshop-admin) notifications for ops observability.
//
// This module is the single catalog of the *new* operator pings beyond the
// original sign-in / new-list / impersonation set (those still live next to
// their handlers in routes/v1/auth.ts and routes/v1/lists.ts). Three tiers:
//
//   Tier 1 — social graph / growth: friend requests + friendships, list joins.
//   Tier 2 — activation / first-use: first score, Letterboxd connect, game add.
//   Tier 3 — ops / safety hygiene: all-sessions sign-out, list archive,
//            ownership transfer, inbound source webhook.
//
// Shape mirrors the existing `buildSignInNotification` pattern: a pure
// `build*Notification(...) => { content, kind }` (exported, unit-tested in
// opsNotifications.test.ts with no DB or Discord), plus a thin async `notify*`
// wrapper that resolves human labels and hands off to `notifyDiscord`.
//
// Every wrapper routes through `safeNotify`, which swallows + logs any failure
// (a label lookup that throws, Discord down, …). An operator notification must
// never break the user action that triggered it — the friend request, score,
// or archive has already committed by the time we ping.

import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { gameScores, itemScores, lists, users } from "../db/schema.js";
import { userLabel } from "./admin.js";
import { getConfig } from "./config.js";
import { notifyDiscord } from "./discord.js";
import { logger } from "./logger.js";
import type { DbClient } from "./sql.js";

type Notification = { content: string; kind: string };

// --- Pure builders (exported for tests) -------------------------------------

/** Tier 1: a directed friend request was sent (no edge formed yet). */
export function buildFriendRequestSentNotification(sender: string, target: string): Notification {
  return {
    content: `:envelope_with_arrow: friend request — ${sender} → ${target}`,
    kind: "friend_request",
  };
}

/**
 * Tier 1: a friendship edge was formed. `via` explains how it happened so the
 * channel reads cleanly: "accepted request", "accepted invite link", or
 * "mutual request" (both sides requested → auto-accept).
 */
export function buildFriendshipFormedNotification(a: string, b: string, via: string): Notification {
  return { content: `:handshake: new friendship — ${a} ↔ ${b} (${via})`, kind: "friend_added" };
}

/** Tier 1: someone joined a shared list. `via` = "share link" or "invite link". */
export function buildListJoinedNotification(
  user: string,
  listName: string,
  via: string,
): Notification {
  return {
    content: `:inbox_tray: list joined — ${user} joined "${listName}" (${via})`,
    kind: "list_joined",
  };
}

/** Tier 2: a user posted their first-ever score (activation signal). */
export function buildFirstScoreNotification(user: string, gameTitle: string): Notification {
  return {
    content: `:dart: first score — ${user} posted their first score (${gameTitle})`,
    kind: "first_score",
  };
}

/** Tier 2: a user connected (or changed) their Letterboxd account. */
export function buildLetterboxdConnectedNotification(
  user: string,
  username: string,
  filmCount: number,
): Notification {
  const films = filmCount === 1 ? "film" : "films";
  return {
    content: `:clapper: Letterboxd connected — ${user} linked @${username} (${filmCount} ${films})`,
    kind: "letterboxd_connected",
  };
}

/** Tier 2: a user added a game to My Games. */
export function buildGameAddedNotification(user: string, gameTitle: string): Notification {
  return {
    content: `:video_game: game added — ${user} added "${gameTitle}" to My Games`,
    kind: "game_added",
  };
}

/**
 * Tier 3: someone (re-)taught a game's scoring config — the one write surface
 * where any signed-in user changes a *global* catalog row. Every teach pings
 * so a poisoned spec is visible in #workshop-admin the moment it lands, not
 * when a user complains; `game_spec_revisions` holds the matching audit row.
 */
export function buildScoreSpecTaughtNotification(
  user: string,
  gameTitle: string,
  opts: { replacedExisting: boolean; scoreDirection: "asc" | "desc"; hasSummarySpec: boolean },
): Notification {
  const verb = opts.replacedExisting ? "re-taught" : "taught";
  const direction = opts.scoreDirection === "asc" ? "lower is better" : "higher is better";
  const summary = opts.hasSummarySpec ? ", with recap trim" : "";
  return {
    content: `:teacher: score spec ${verb} — ${user} ${verb} "${gameTitle}" (${direction}${summary})`,
    kind: "score_spec_taught",
  };
}

/** Tier 3: a user signed out of every device (session revocation). */
export function buildSessionsRevokedNotification(user: string): Notification {
  return {
    content: `:lock: all sessions signed out — ${user} signed out of every device`,
    kind: "sessions_revoked",
  };
}

/** Tier 3: a list was archived (owner-only soft-delete). */
export function buildListArchivedNotification(user: string, listName: string): Notification {
  return {
    content: `:wastebasket: list archived — ${user} archived "${listName}"`,
    kind: "list_archived",
  };
}

/** Tier 3: list ownership was transferred from one member to another. */
export function buildOwnershipTransferredNotification(
  listName: string,
  fromUser: string,
  toUser: string,
): Notification {
  return {
    content: `:crown: ownership transferred — "${listName}" ${fromUser} → ${toUser}`,
    kind: "ownership_transferred",
  };
}

/** Tier 3: a verified inbound source webhook fired (unauthenticated surface). */
export function buildSourceWebhookNotification(
  slug: string,
  kind: string,
  addedCount: number,
): Notification {
  return {
    content: `:satellite: source webhook — "${kind}" fired (slug ${slug}, +${addedCount} items)`,
    kind: "source_webhook",
  };
}

// --- DB label helpers -------------------------------------------------------

/** Resolve a friendly display label for a user id (display name → email → id). */
async function loadUserLabel(userId: string, db: DbClient = getDb()): Promise<string> {
  const [row] = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ? userLabel(row) : userId;
}

/** Resolve a list's display name; falls back to the id if the row is gone. */
async function loadListName(listId: string, db: DbClient = getDb()): Promise<string> {
  const [row] = await db
    .select({ name: lists.name })
    .from(lists)
    .where(eq(lists.id, listId))
    .limit(1);
  return row?.name ?? listId;
}

/**
 * True if the user already has at least one score (in either the canonical
 * `game_scores` table or the legacy `item_scores` fallback). Call this BEFORE
 * the upsert so the row being written doesn't count — a `false` result means
 * the post in flight is the user's first ever.
 */
export async function userHasAnyScore(userId: string, db: DbClient = getDb()): Promise<boolean> {
  const [game] = await db
    .select({ userId: gameScores.userId })
    .from(gameScores)
    .where(eq(gameScores.userId, userId))
    .limit(1);
  if (game) return true;
  const [item] = await db
    .select({ userId: itemScores.userId })
    .from(itemScores)
    .where(eq(itemScores.userId, userId))
    .limit(1);
  return Boolean(item);
}

// --- Async wrappers (best-effort; never throw to the caller) ----------------

/**
 * Whether operator notifications are wired up (the `#workshop-admin` webhook is
 * set). False in local dev by default and any env that leaves the webhook env
 * empty. Callers gate notification-only DB work (e.g. the first-score
 * existence check on the hot score path) on this so an unconfigured deploy
 * pays nothing — `getConfig()` is memoized, so the check itself is free.
 */
export function opsNotificationsEnabled(): boolean {
  return Boolean(getConfig().discordNotifyWebhookUrl);
}

async function safeNotify(build: () => Promise<Notification>): Promise<void> {
  // Short-circuit before resolving any labels: with no webhook there's nothing
  // to deliver, so we skip the per-ping DB lookups entirely (notifyDiscord
  // would no-op anyway, but only after we'd paid for the labels).
  if (!opsNotificationsEnabled()) return;
  try {
    const { content, kind } = await build();
    await notifyDiscord(content, { kind });
  } catch (error) {
    // A failed operator ping must never surface to the user — the triggering
    // action already committed. Log so it's still traceable from CloudWatch.
    logger.warn("ops notification failed", { error });
  }
}

export async function notifyFriendRequestSent(senderId: string, targetId: string): Promise<void> {
  await safeNotify(async () =>
    buildFriendRequestSentNotification(
      await loadUserLabel(senderId),
      await loadUserLabel(targetId),
    ),
  );
}

export async function notifyFriendshipFormed(aId: string, bId: string, via: string): Promise<void> {
  await safeNotify(async () =>
    buildFriendshipFormedNotification(await loadUserLabel(aId), await loadUserLabel(bId), via),
  );
}

export async function notifyListJoined(
  userId: string,
  listName: string,
  via: string,
): Promise<void> {
  await safeNotify(async () =>
    buildListJoinedNotification(await loadUserLabel(userId), listName, via),
  );
}

export async function notifyFirstScore(userId: string, gameTitle: string): Promise<void> {
  await safeNotify(async () => buildFirstScoreNotification(await loadUserLabel(userId), gameTitle));
}

export async function notifyLetterboxdConnected(
  userId: string,
  username: string,
  filmCount: number,
): Promise<void> {
  await safeNotify(async () =>
    buildLetterboxdConnectedNotification(await loadUserLabel(userId), username, filmCount),
  );
}

export async function notifyGameAdded(userId: string, gameTitle: string): Promise<void> {
  await safeNotify(async () => buildGameAddedNotification(await loadUserLabel(userId), gameTitle));
}

export async function notifyScoreSpecTaught(
  userId: string,
  gameTitle: string,
  opts: { replacedExisting: boolean; scoreDirection: "asc" | "desc"; hasSummarySpec: boolean },
): Promise<void> {
  await safeNotify(async () =>
    buildScoreSpecTaughtNotification(await loadUserLabel(userId), gameTitle, opts),
  );
}

export async function notifySessionsRevoked(userId: string): Promise<void> {
  await safeNotify(async () => buildSessionsRevokedNotification(await loadUserLabel(userId)));
}

export async function notifyListArchived(userId: string, listName: string): Promise<void> {
  await safeNotify(async () =>
    buildListArchivedNotification(await loadUserLabel(userId), listName),
  );
}

export async function notifyOwnershipTransferred(
  listId: string,
  fromUserId: string,
  toUserId: string,
): Promise<void> {
  await safeNotify(async () =>
    buildOwnershipTransferredNotification(
      await loadListName(listId),
      await loadUserLabel(fromUserId),
      await loadUserLabel(toUserId),
    ),
  );
}

export async function notifySourceWebhook(
  slug: string,
  kind: string,
  addedCount: number,
): Promise<void> {
  await safeNotify(async () => buildSourceWebhookNotification(slug, kind, addedCount));
}
