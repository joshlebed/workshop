import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { withDbRetry } from "../db/retry.js";
import { authSessions, type DbAuthSession } from "../db/schema.js";
import { getConfig } from "./config.js";
import { isSessionRevoked } from "./sessionRevocation.js";

const REFRESH_TOKEN_PREFIX = "r1";
const IDLE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const ABSOLUTE_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const ROTATION_GRACE_MS = 10_000;
const metadataMaxLength = 256;

const parsedRefreshSchema = z.object({
  sessionId: z.string().uuid(),
  version: z.number().int().positive(),
});

interface DeviceMetadata {
  platform?: string | null;
  appVersion?: string | null;
  userAgent?: string | null;
}

export class DeviceSessionError extends Error {
  constructor(
    readonly reason: "invalid" | "expired" | "reused",
    message = "invalid or expired session",
  ) {
    super(message);
    this.name = "DeviceSessionError";
  }
}

function trimMetadata(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, metadataMaxLength) : null;
}

function refreshSignature(sessionId: string, version: number): Buffer {
  return createHmac("sha256", getConfig().sessionSecret)
    .update(`workshop-refresh-v1:${sessionId}:${version}`)
    .digest();
}

function b64url(input: Buffer): string {
  return input.toString("base64url");
}

function parseRefreshToken(token: string): z.infer<typeof parsedRefreshSchema> | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [prefix, sessionId, rawVersion, rawSignature] = parts;
  if (prefix !== REFRESH_TOKEN_PREFIX || !sessionId || !rawVersion || !rawSignature) return null;

  const version = Number(rawVersion);
  const parsed = parsedRefreshSchema.safeParse({ sessionId, version });
  if (!parsed.success) return null;

  let provided: Buffer;
  try {
    provided = Buffer.from(rawSignature, "base64url");
  } catch {
    return null;
  }
  const expected = refreshSignature(parsed.data.sessionId, parsed.data.version);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  return parsed.data;
}

function refreshTokenFor(sessionId: string, version: number): string {
  return `${REFRESH_TOKEN_PREFIX}.${sessionId}.${version}.${b64url(refreshSignature(sessionId, version))}`;
}

function idleExpiry(now: Date, absoluteExpiresAt: Date): Date {
  return new Date(Math.min(now.getTime() + IDLE_TTL_MS, absoluteExpiresAt.getTime()));
}

function isActive(row: DbAuthSession, now: Date): boolean {
  return (
    row.revokedAt === null &&
    row.idleExpiresAt.getTime() > now.getTime() &&
    row.absoluteExpiresAt.getTime() > now.getTime()
  );
}

export async function createDeviceSession(input: {
  userId: string;
  impersonatedUserId?: string | null;
  metadata?: DeviceMetadata;
  now?: Date;
}): Promise<{ session: DbAuthSession; refreshToken: string }> {
  const db = getDb();
  const now = input.now ?? new Date();
  const absoluteExpiresAt = new Date(now.getTime() + ABSOLUTE_TTL_MS);
  const [session] = await db
    .insert(authSessions)
    .values({
      userId: input.userId,
      impersonatedUserId: input.impersonatedUserId ?? null,
      platform: trimMetadata(input.metadata?.platform),
      appVersion: trimMetadata(input.metadata?.appVersion),
      userAgent: trimMetadata(input.metadata?.userAgent),
      createdAt: now,
      lastUsedAt: now,
      idleExpiresAt: idleExpiry(now, absoluteExpiresAt),
      absoluteExpiresAt,
    })
    .returning();
  if (!session) throw new Error("auth session insert returned no row");
  return { session, refreshToken: refreshTokenFor(session.id, session.refreshVersion) };
}

export async function rotateDeviceSession(
  refreshToken: string,
  now = new Date(),
): Promise<{ session: DbAuthSession; refreshToken: string }> {
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) throw new DeviceSessionError("invalid");

  const db = getDb();
  const [observed] = await withDbRetry(
    () => db.select().from(authSessions).where(eq(authSessions.id, parsed.sessionId)).limit(1),
    { label: "rotateDeviceSession" },
  );
  if (!observed) throw new DeviceSessionError("invalid");
  if (!isActive(observed, now)) throw new DeviceSessionError("expired");

  const subjectUserId = observed.impersonatedUserId ?? observed.userId;
  const issuedAt = Math.floor(observed.createdAt.getTime() / 1000);
  if (
    (await isSessionRevoked(observed.userId, issuedAt, {
      sessionId: observed.id,
      subjectUserId,
    })) ||
    (subjectUserId !== observed.userId && (await isSessionRevoked(subjectUserId, issuedAt)))
  ) {
    await revokeDeviceSession(observed.id, observed.userId, now);
    throw new DeviceSessionError("expired");
  }

  if (observed.refreshVersion === parsed.version) {
    const [rotated] = await db
      .update(authSessions)
      .set({
        refreshVersion: parsed.version + 1,
        lastUsedAt: now,
        idleExpiresAt: idleExpiry(now, observed.absoluteExpiresAt),
        rotatedAt: now,
      })
      .where(
        and(
          eq(authSessions.id, parsed.sessionId),
          eq(authSessions.refreshVersion, parsed.version),
          isNull(authSessions.revokedAt),
          gt(authSessions.idleExpiresAt, now),
          gt(authSessions.absoluteExpiresAt, now),
        ),
      )
      .returning();
    if (rotated) {
      return {
        session: rotated,
        refreshToken: refreshTokenFor(rotated.id, rotated.refreshVersion),
      };
    }
  }

  // A second tab/request may race the first rotation. Return the already-
  // rotated token briefly so normal concurrency does not look like theft.
  const [latest] = await db
    .select()
    .from(authSessions)
    .where(eq(authSessions.id, parsed.sessionId))
    .limit(1);
  if (!latest || !isActive(latest, now)) throw new DeviceSessionError("expired");
  if (
    latest.refreshVersion === parsed.version + 1 &&
    latest.rotatedAt &&
    now.getTime() - latest.rotatedAt.getTime() <= ROTATION_GRACE_MS
  ) {
    return {
      session: latest,
      refreshToken: refreshTokenFor(latest.id, latest.refreshVersion),
    };
  }

  // A valid, older token outside the duplicate-request window is replay.
  if (parsed.version < latest.refreshVersion) {
    await revokeDeviceSession(latest.id, latest.userId, now);
    throw new DeviceSessionError("reused");
  }
  throw new DeviceSessionError("invalid");
}

export async function setDeviceSessionImpersonation(
  sessionId: string,
  ownerUserId: string,
  impersonatedUserId: string | null,
  now = new Date(),
): Promise<boolean> {
  const [updated] = await getDb()
    .update(authSessions)
    .set({ impersonatedUserId })
    .where(
      and(
        eq(authSessions.id, sessionId),
        eq(authSessions.userId, ownerUserId),
        isNull(authSessions.revokedAt),
        gt(authSessions.idleExpiresAt, now),
        gt(authSessions.absoluteExpiresAt, now),
      ),
    )
    .returning({ id: authSessions.id });
  return Boolean(updated);
}

export async function revokeDeviceSession(
  sessionId: string,
  ownerUserId: string,
  now = new Date(),
): Promise<void> {
  await getDb()
    .update(authSessions)
    .set({ revokedAt: now })
    .where(
      and(
        eq(authSessions.id, sessionId),
        eq(authSessions.userId, ownerUserId),
        isNull(authSessions.revokedAt),
      ),
    );
}
