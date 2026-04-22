import { createHash, randomInt } from "node:crypto";
import type { RequestMagicLinkResponse, VerifyMagicLinkResponse } from "@workshop/shared";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { magicTokens, users } from "../db/schema.js";
import { sendMagicLinkEmail } from "../lib/email.js";
import { logger } from "../lib/logger.js";
import { signSession } from "../lib/session.js";

const MAGIC_TOKEN_TTL_MS = 15 * 60 * 1000;

const requestSchema = z.object({
  email: z.string().email().toLowerCase(),
});

const verifySchema = z.object({
  email: z.string().email().toLowerCase(),
  code: z.string().regex(/^\d{6}$/),
});

function hashCode(email: string, code: string): string {
  // Scope the hash to email so the same 6-digit code for different users
  // has a different hash (reduces collision guessing surface).
  return createHash("sha256").update(`${email.toLowerCase()}:${code}`).digest("hex");
}

function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export const authRoutes = new Hono();

authRoutes.post("/request", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid email" }, 400);
  }

  const { email } = parsed.data;
  const code = generateCode();
  const tokenHash = hashCode(email, code);
  const expiresAt = new Date(Date.now() + MAGIC_TOKEN_TTL_MS);

  const db = getDb();
  await db.insert(magicTokens).values({ tokenHash, email, expiresAt });

  await sendMagicLinkEmail(email, code);

  const response: RequestMagicLinkResponse = { ok: true };
  return c.json(response);
});

authRoutes.post("/verify", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid code" }, 400);
  }

  const { email, code } = parsed.data;
  const tokenHash = hashCode(email, code);
  const db = getDb();

  const [magic] = await db
    .select()
    .from(magicTokens)
    .where(
      and(
        eq(magicTokens.tokenHash, tokenHash),
        isNull(magicTokens.consumedAt),
        gt(magicTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!magic) {
    return c.json({ error: "invalid or expired code" }, 401);
  }

  await db.update(magicTokens).set({ consumedAt: new Date() }).where(eq(magicTokens.id, magic.id));

  let user: InferSelectModel<typeof users> | undefined;
  const [existing] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${magic.email})`)
    .limit(1);
  if (existing) {
    user = existing;
  } else {
    [user] = await db.insert(users).values({ email: magic.email }).returning();
  }

  if (!user) {
    logger.error("failed to upsert user after magic verification", { email: magic.email });
    return c.json({ error: "internal error" }, 500);
  }

  const sessionToken = signSession(user.id);
  const response: VerifyMagicLinkResponse = {
    sessionToken,
    user: {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
    },
  };
  return c.json(response);
});
