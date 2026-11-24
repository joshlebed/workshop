// Instant operator-channel (#workshop-admin) notifications.
//
// This channel is for things a human may need to act on: safety and abuse
// signals, global catalog writes (teach), and account-level security events.
// Routine growth and activity (game adds, friendships, first scores, list
// activity) are NOT pinged one by one: `jobs/dailyDigest.ts` counts them from
// their tables once a day. Before adding a ping here, ask whether it belongs in
// the digest instead.
//
// Shape mirrors `buildSignInNotification`: a pure
// `build*Notification(...) => { content, kind }` (exported, unit-tested in
// opsNotifications.test.ts with no DB or Discord), plus a thin async `notify*`
// wrapper that resolves human labels and hands off to `notifyDiscord`.
//
// Every wrapper routes through `safeNotify`, which swallows + logs any failure
// (a label lookup that throws, Discord down, …). An operator notification must
// never break the user action that triggered it: the action has already
// committed by the time we ping.

import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { lists, users } from "../db/schema.js";
import { userLabel } from "./admin.js";
import { getConfig } from "./config.js";
import { notifyDiscord } from "./discord.js";
import { logger } from "./logger.js";
import type { DbClient } from "./sql.js";

type Notification = { content: string; kind: string };

// --- Pure builders (exported for tests) -------------------------------------

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
    content: `🧑‍🏫 score spec ${verb} — ${user} ${verb} "${gameTitle}" (${direction}${summary})`,
    kind: "score_spec_taught",
  };
}

/**
 * Teach v2: new parser code was accepted for a game — a first teach, a
 * correction, or a switch after a second user agreed. The only teach event
 * that pings; conflicts and rejected attempts are log lines.
 */
export function buildParserTaughtNotification(
  user: string,
  opts: {
    gameTitle: string;
    version: number;
    kind: "first" | "reteach" | "switch";
    /** One line: the share it was taught from and the value picked. */
    example: string;
    rowsNewlyRead: number;
    rowsChanged: number;
    direction: "asc" | "desc" | null;
  },
): Notification {
  const verb = opts.kind === "first" ? "taught" : opts.kind === "switch" ? "switched" : "re-taught";
  const extras = [
    opts.direction ? (opts.direction === "asc" ? "lower is better" : "higher is better") : null,
    opts.rowsNewlyRead > 0 ? `${opts.rowsNewlyRead} unread now read` : null,
    opts.rowsChanged > 0 ? `${opts.rowsChanged} re-read` : null,
  ].filter(Boolean);
  const tail = extras.length > 0 ? ` (${extras.join(", ")})` : "";
  return {
    content: `🧑‍🏫 parser ${verb} — ${user} ${verb} "${opts.gameTitle}" → v${opts.version}${tail}\n> ${opts.example}`,
    kind: "parser_taught",
  };
}

/** Teach v2: a game's score direction changed (its setter, or two users agreeing). */
export function buildDirectionChangedNotification(
  user: string,
  opts: { gameTitle: string; from: "asc" | "desc"; to: "asc" | "desc" },
): Notification {
  const words = (d: "asc" | "desc") => (d === "asc" ? "lower is better" : "higher is better");
  return {
    content: `↕️ score direction changed — ${user} set "${opts.gameTitle}" to ${words(opts.to)} (was ${words(opts.from)})`,
    kind: "direction_changed",
  };
}

/**
 * Tier 3 (security): a refresh credential that had already been rotated — and
 * whose successor had already been used — was presented again, so the device
 * session was revoked and the user will be asked to sign in. After the
 * lost-response re-issue path (`rotateDeviceSession`), this only fires when
 * two parties really hold the same credential, so it reads as a theft signal
 * and the user's next sign-in is expected.
 */
export function buildRefreshReplayRevokedNotification(
  user: string,
  platform: string | null,
): Notification {
  const where = platform ? ` from ${platform}` : "";
  return {
    content: `🚩 refresh replay — ${user}'s device session was revoked${where} (an already-rotated refresh token was presented again); they'll be asked to sign in`,
    kind: "refresh_replay_revoked",
  };
}

/** Tier 3: a user signed out of every device (session revocation). */
export function buildSessionsRevokedNotification(user: string): Notification {
  return {
    content: `🔒 all sessions signed out — ${user} signed out of every device`,
    kind: "sessions_revoked",
  };
}

/** Tier 3: list ownership was transferred from one member to another. */
export function buildOwnershipTransferredNotification(
  listName: string,
  fromUser: string,
  toUser: string,
): Notification {
  return {
    content: `👑 ownership transferred — "${listName}" ${fromUser} → ${toUser}`,
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
    content: `📡 source webhook — "${kind}" fired (slug ${slug}, +${addedCount} items)`,
    kind: "source_webhook",
  };
}

/**
 * Tier 3 (safety): a user reported someone's content. Apple's 1.2 guideline
 * requires the developer to act within 24h, so this ping is the SLA clock —
 * it always fires, and carries the ids the runbook's eject script needs.
 */
export function buildContentReportNotification(
  reporter: string,
  target: string,
  targetId: string,
  contentKind: string,
  reason: string,
  snapshot: string | null,
): Notification {
  const what = contentKind === "score" ? "a score post" : "their profile";
  const quoted = snapshot ? ` — "${snapshot.replace(/\s+/g, " ").slice(0, 120)}"` : "";
  return {
    content: `🚨 content report — ${reporter} reported ${target} (${what}, ${reason})${quoted} · target id ${targetId} · act within 24h: docs/moderation-runbook.md`,
    kind: "content_report",
  };
}

/** Tier 3 (safety): a user blocked another. Apple requires the developer be told. */
export function buildUserBlockedNotification(
  blocker: string,
  blocked: string,
  blockedId: string,
): Notification {
  return {
    content: `⛔ user blocked — ${blocker} blocked ${blocked} · blocked id ${blockedId}`,
    kind: "user_blocked",
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

// --- Async wrappers (best-effort; never throw to the caller) ----------------

async function safeNotify(build: () => Promise<Notification>): Promise<void> {
  // Short-circuit before resolving any labels: with no webhook there's nothing
  // to deliver, so we skip the per-ping DB lookups entirely (notifyDiscord
  // would no-op anyway, but only after we'd paid for the labels).
  if (!getConfig().discordNotifyWebhookUrl) return;
  try {
    const { content, kind } = await build();
    await notifyDiscord(content, { kind });
  } catch (error) {
    // A failed operator ping must never surface to the user — the triggering
    // action already committed. Log so it's still traceable from CloudWatch.
    logger.warn("ops notification failed", { error });
  }
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

export async function notifyParserTaught(
  userId: string,
  opts: Parameters<typeof buildParserTaughtNotification>[1],
): Promise<void> {
  await safeNotify(async () => buildParserTaughtNotification(await loadUserLabel(userId), opts));
}

export async function notifyDirectionChanged(
  userId: string,
  opts: Parameters<typeof buildDirectionChangedNotification>[1],
): Promise<void> {
  await safeNotify(async () =>
    buildDirectionChangedNotification(await loadUserLabel(userId), opts),
  );
}

export async function notifyRefreshReplayRevoked(
  userId: string,
  platform: string | null,
): Promise<void> {
  await safeNotify(async () =>
    buildRefreshReplayRevokedNotification(await loadUserLabel(userId), platform),
  );
}

export async function notifySessionsRevoked(userId: string): Promise<void> {
  await safeNotify(async () => buildSessionsRevokedNotification(await loadUserLabel(userId)));
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

export async function notifyContentReport(
  reporterId: string,
  targetId: string,
  contentKind: string,
  reason: string,
  snapshot: string | null,
): Promise<void> {
  await safeNotify(async () =>
    buildContentReportNotification(
      await loadUserLabel(reporterId),
      await loadUserLabel(targetId),
      targetId,
      contentKind,
      reason,
      snapshot,
    ),
  );
}

export async function notifyUserBlocked(blockerId: string, blockedId: string): Promise<void> {
  await safeNotify(async () =>
    buildUserBlockedNotification(
      await loadUserLabel(blockerId),
      await loadUserLabel(blockedId),
      blockedId,
    ),
  );
}
