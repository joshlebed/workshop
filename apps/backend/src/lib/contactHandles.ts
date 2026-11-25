// "Let friends find me" + contact matching (onboarding spike #3).
//
// Hashing scheme (see `@workshop/shared/contacts` for the client half):
//   client digest  = SHA-256("highscore-contact-v1|<kind>|<normalized handle>")
//   stored hash    = HMAC-SHA256(pepper, client digest), lowercase hex
// The client only ever sends digests. The server peppers each submitted digest,
// looks it up, and keeps none of them; `user_contact_handles` only holds the
// peppered digest of a handle its owner opted in with, computed here from
// their own account email. The pepper is `CONTACT_HASH_PEPPER` when set, else
// derived from `SESSION_SECRET` (HKDF, purpose-separated). It stops a leaked
// table from being reversed by hashing guesses — without it, an unpeppered
// SHA-256 of an email or phone number can be brute-forced.

import { createHmac, hkdfSync } from "node:crypto";
import {
  type ContactMatch,
  type ContactRelationship,
  contactHandleDigest,
  type DiscoverabilityResponse,
  isAppleRelayEmail,
  normalizeEmail,
} from "@workshop/shared/contacts";
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { getDb } from "../db/client.js";
import {
  contactDiscoveryEvents,
  friendRequests,
  friendships,
  userContactHandles,
  users,
} from "../db/schema.js";
import { blockedIdsFor } from "./blocks.js";
import { getConfig } from "./config.js";
import { logger } from "./logger.js";

let derived: { secret: string; pepper: Buffer } | null = null;

function pepper(): Buffer {
  const config = getConfig();
  if (config.contactHashPepper) return Buffer.from(config.contactHashPepper, "utf8");
  if (derived?.secret === config.sessionSecret) return derived.pepper;
  const key = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(config.sessionSecret, "utf8"),
      Buffer.alloc(0),
      "contact-handles:v1",
      32,
    ),
  );
  derived = { secret: config.sessionSecret, pepper: key };
  return key;
}

/** The stored form of a client digest. */
export function pepperDigest(clientDigest: string): string {
  return createHmac("sha256", pepper()).update(clientDigest, "utf8").digest("hex");
}

function emailHash(email: string): string | null {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return pepperDigest(contactHandleDigest("email", normalized));
}

export async function loadDiscoverability(userId: string): Promise<DiscoverabilityResponse | null> {
  const db = getDb();
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;
  const rows = await db
    .select({ kind: userContactHandles.kind })
    .from(userContactHandles)
    .where(eq(userContactHandles.userId, userId));
  const address = user.email ? normalizeEmail(user.email) : null;
  return {
    email: {
      enabled: rows.some((r) => r.kind === "email"),
      address,
      isRelay: address ? isAppleRelayEmail(address) : false,
    },
    phone: { enabled: false, available: false },
  };
}

export type SetDiscoverabilityResult =
  | { ok: true; state: DiscoverabilityResponse }
  | { ok: false; reason: "not_found" | "no_email" };

/**
 * Turn "find me by email" on (writes the peppered hash of the account email)
 * or off (deletes it). On is idempotent and refreshes the hash, so it also
 * picks up a changed account email or a rotated pepper.
 */
export async function setEmailDiscoverability(
  userId: string,
  enabled: boolean,
): Promise<SetDiscoverabilityResult> {
  const db = getDb();
  if (!enabled) {
    await db
      .delete(userContactHandles)
      .where(and(eq(userContactHandles.userId, userId), eq(userContactHandles.kind, "email")));
  } else {
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) return { ok: false, reason: "not_found" };
    const hash = user.email ? emailHash(user.email) : null;
    if (!hash) return { ok: false, reason: "no_email" };
    await db
      .insert(userContactHandles)
      .values({ userId, kind: "email", hash })
      .onConflictDoUpdate({
        target: [userContactHandles.userId, userContactHandles.kind],
        set: { hash },
      });
  }
  const state = await loadDiscoverability(userId);
  return state ? { ok: true, state } : { ok: false, reason: "not_found" };
}

/**
 * Recompute every stored email handle from `users.email` — the recovery after
 * a pepper change. Rows whose account lost its email are removed.
 */
export async function rehashAllContactHandles(): Promise<{ updated: number; removed: number }> {
  const db = getDb();
  const rows = await db
    .select({ userId: userContactHandles.userId, email: users.email })
    .from(userContactHandles)
    .innerJoin(users, eq(users.id, userContactHandles.userId))
    .where(eq(userContactHandles.kind, "email"));
  let updated = 0;
  let removed = 0;
  for (const row of rows) {
    const hash = row.email ? emailHash(row.email) : null;
    if (hash) {
      await db
        .update(userContactHandles)
        .set({ hash })
        .where(
          and(eq(userContactHandles.userId, row.userId), eq(userContactHandles.kind, "email")),
        );
      updated++;
    } else {
      await setEmailDiscoverability(row.userId, false);
      removed++;
    }
  }
  return { updated, removed };
}

/**
 * Discoverable users matching any of `digests` (already validated hex), minus
 * the viewer, anyone blocked either way, and nameless accounts. Each match
 * carries the submitted digests it matched and the viewer's relationship to
 * them. Nothing submitted is stored.
 */
export async function matchContactDigests(
  viewerId: string,
  digests: readonly string[],
): Promise<ContactMatch[]> {
  const unique = [...new Set(digests)];
  if (unique.length === 0) return [];
  const byStored = new Map<string, string>();
  for (const d of unique) byStored.set(pepperDigest(d), d);

  const db = getDb();
  const rows = await db
    .select({
      userId: userContactHandles.userId,
      hash: userContactHandles.hash,
      displayName: users.displayName,
    })
    .from(userContactHandles)
    .innerJoin(users, eq(users.id, userContactHandles.userId))
    .where(
      and(inArray(userContactHandles.hash, [...byStored.keys()]), isNotNull(users.displayName)),
    );

  const blocked = await blockedIdsFor(viewerId);
  const byUser = new Map<string, { displayName: string | null; digests: Set<string> }>();
  for (const row of rows) {
    if (row.userId === viewerId || blocked.has(row.userId)) continue;
    const digest = byStored.get(row.hash);
    if (!digest) continue;
    const entry = byUser.get(row.userId) ?? { displayName: row.displayName, digests: new Set() };
    entry.digests.add(digest);
    byUser.set(row.userId, entry);
  }
  if (byUser.size === 0) return [];

  const ids = [...byUser.keys()];
  const [edges, pending] = await Promise.all([
    db
      .select({ userLow: friendships.userLow, userHigh: friendships.userHigh })
      .from(friendships)
      .where(
        or(
          and(eq(friendships.userLow, viewerId), inArray(friendships.userHigh, ids)),
          and(eq(friendships.userHigh, viewerId), inArray(friendships.userLow, ids)),
        ),
      ),
    db
      .select({ inviterId: friendRequests.inviterId, inviteeId: friendRequests.inviteeId })
      .from(friendRequests)
      .where(
        and(
          eq(friendRequests.status, "pending"),
          or(
            and(eq(friendRequests.inviterId, viewerId), inArray(friendRequests.inviteeId, ids)),
            and(eq(friendRequests.inviteeId, viewerId), inArray(friendRequests.inviterId, ids)),
          ),
        ),
      ),
  ]);
  const friendIds = new Set(edges.map((e) => (e.userLow === viewerId ? e.userHigh : e.userLow)));
  const outgoing = new Set(pending.filter((p) => p.inviterId === viewerId).map((p) => p.inviteeId));
  const incoming = new Set(pending.filter((p) => p.inviteeId === viewerId).map((p) => p.inviterId));

  const relationship = (id: string): ContactRelationship =>
    friendIds.has(id)
      ? "friend"
      : incoming.has(id)
        ? "incoming"
        : outgoing.has(id)
          ? "outgoing"
          : "none";

  return ids
    .map((id) => {
      const entry = byUser.get(id);
      return {
        userId: id,
        displayName: entry?.displayName ?? null,
        digests: [...(entry?.digests ?? [])].sort(),
        relationship: relationship(id),
      };
    })
    .sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? ""));
}

export interface ContactEventInput {
  event: string;
  count?: number | null;
  matchedCount?: number | null;
  detail?: string | null;
  targetUserId?: string | null;
}

/**
 * One funnel row in `contact_discovery_events` plus a `contacts_funnel` log
 * line. Counts and ids only. Never throws: instrumentation can't fail the
 * action it describes.
 */
export async function recordContactEvent(userId: string, input: ContactEventInput): Promise<void> {
  logger.info("contacts_funnel", {
    kind: "contacts_funnel",
    user_id: userId,
    event: input.event,
    count: input.count ?? null,
    matched_count: input.matchedCount ?? null,
    detail: input.detail ?? null,
  });
  try {
    await getDb()
      .insert(contactDiscoveryEvents)
      .values({
        userId,
        event: input.event,
        count: input.count ?? null,
        matchedCount: input.matchedCount ?? null,
        detail: input.detail ?? null,
        targetUserId: input.targetUserId ?? null,
      });
  } catch (error) {
    logger.warn("contacts_funnel insert failed", { error, event: input.event });
  }
}
