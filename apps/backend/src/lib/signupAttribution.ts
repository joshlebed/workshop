// Signup attribution: "who invited them / how did they find the app?"
//
// The signing-in client sends what it knows (`SignupAcquisition` in
// @workshop/shared): the invite / play-link token it stashed before sending
// the visitor through sign-in, and on web the first page load's referrer,
// landing path and utm_* params. For a brand-new account only, the backend
// resolves a token to the user whose link it is and records the result on
// `users.signup_source` / `referred_by_user_id` / `signup_context`.
//
// Honesty rules: an absent `acquisition` (a client predating this) records
// nothing — the columns stay NULL and the ping says so. A token that no longer
// resolves (rotated invite) keeps its source with no referrer. Nothing here can
// fail a sign-in: the schema drops malformed fields, and the caller wraps the
// DB work in a try/catch.

import type { SignupSource } from "@workshop/shared/constants";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { friendRequests, gameShareLinks, listInvites, users } from "../db/schema.js";
import type { DbClient } from "./sql.js";

const token = z.string().trim().min(1).max(128).optional().catch(undefined);
const utmValue = z.string().trim().min(1).max(128).optional().catch(undefined);

/**
 * Lenient on purpose: each field falls back to `undefined` on its own, so one
 * malformed value never drops the rest, and a non-object becomes `{}` (the
 * client did send attribution, it just told us nothing usable).
 */
export const signupAcquisitionSchema = z
  .object({
    friendInviteToken: token,
    gameShareToken: token,
    listInviteToken: token,
    referrer: z.string().max(2048).optional().catch(undefined),
    landingPath: z.string().max(2048).optional().catch(undefined),
    utm: z
      .object({ source: utmValue, medium: utmValue, campaign: utmValue })
      .optional()
      .catch(undefined),
  })
  .catch({});

/** Parsed `acquisition` (the wire shape is `SignupAcquisition` in @workshop/shared). */
export type SignupAcquisitionInput = z.infer<typeof signupAcquisitionSchema>;

type LinkSource = Extract<SignupSource, "friend_invite" | "play_link" | "list_invite">;

/** Stored in `users.signup_context`. Only the keys we actually know are set. */
interface SignupContext {
  /** Set when the visitor arrived through a link; false = token no longer resolves. */
  linkResolved?: boolean;
  /** Referring page as `https://host/path` (query dropped — it can carry search terms). */
  referrer?: string;
  /** First page's pathname. */
  landingPath?: string;
  utm?: { source?: string; medium?: string; campaign?: string };
}

export interface SignupAttribution {
  source: SignupSource;
  referredByUserId: string | null;
  context: SignupContext;
}

/** `https://news.ycombinator.com/item` → kept; non-http(s) or unparsable → undefined. */
export function sanitizeReferrer(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return `${url.protocol}//${url.host}${url.pathname === "/" ? "" : url.pathname}`.slice(0, 512);
  } catch {
    return undefined;
  }
}

function sanitizeLandingPath(raw: string | undefined): string | undefined {
  if (!raw?.startsWith("/")) return undefined;
  return raw.split(/[?#]/, 1)[0]?.slice(0, 256) || undefined;
}

/** The web-side context (referrer / landing / utm), minus empty keys. */
function webContext(acq: SignupAcquisitionInput): SignupContext {
  const ctx: SignupContext = {};
  const referrer = sanitizeReferrer(acq.referrer);
  if (referrer) ctx.referrer = referrer;
  const landingPath = sanitizeLandingPath(acq.landingPath);
  if (landingPath) ctx.landingPath = landingPath;
  const utm = Object.fromEntries(
    Object.entries(acq.utm ?? {}).filter(([, v]) => typeof v === "string" && v.length > 0),
  );
  if (Object.keys(utm).length > 0) ctx.utm = utm;
  return ctx;
}

export type LinkOwnerLookup = (kind: LinkSource, token: string) => Promise<string | null>;

/** DB lookup: whose friend-invite / play / list-invite link is this token? */
export function dbLinkOwnerLookup(db: DbClient = getDb()): LinkOwnerLookup {
  return async (kind, value) => {
    if (kind === "friend_invite") {
      const [row] = await db
        .select({ userId: friendRequests.inviterId })
        .from(friendRequests)
        .where(and(eq(friendRequests.token, value), isNull(friendRequests.inviteeId)))
        .limit(1);
      return row?.userId ?? null;
    }
    if (kind === "play_link") {
      const [row] = await db
        .select({ userId: gameShareLinks.userId })
        .from(gameShareLinks)
        .where(eq(gameShareLinks.token, value))
        .limit(1);
      return row?.userId ?? null;
    }
    const [row] = await db
      .select({ userId: listInvites.invitedBy })
      .from(listInvites)
      .where(eq(listInvites.token, value))
      .limit(1);
    return row?.userId ?? null;
  };
}

/**
 * Turn what the client sent into what we record. `undefined` (no
 * `acquisition` on the request) → null: nothing is written. Links win over
 * web context, friend invite over play link over list invite; the first link
 * that resolves to someone other than the new user is the referrer.
 */
export async function resolveSignupAttribution(
  acq: SignupAcquisitionInput | undefined,
  newUserId: string,
  lookup: LinkOwnerLookup,
): Promise<SignupAttribution | null> {
  if (!acq) return null;
  const context = webContext(acq);
  const links: [LinkSource, string | undefined][] = [
    ["friend_invite", acq.friendInviteToken],
    ["play_link", acq.gameShareToken],
    ["list_invite", acq.listInviteToken],
  ];
  let firstSent: LinkSource | null = null;
  for (const [kind, value] of links) {
    if (!value) continue;
    firstSent ??= kind;
    const owner = await lookup(kind, value);
    if (owner && owner !== newUserId) {
      return { source: kind, referredByUserId: owner, context: { ...context, linkResolved: true } };
    }
  }
  if (firstSent) {
    return {
      source: firstSent,
      referredByUserId: null,
      context: { ...context, linkResolved: false },
    };
  }
  if (context.referrer || context.utm) {
    return { source: "web_referral", referredByUserId: null, context };
  }
  return { source: "none", referredByUserId: null, context };
}

/** Write once: a row that already has a source (re-run, race) is left alone. */
export async function recordSignupAttribution(
  userId: string,
  attribution: SignupAttribution,
  db: DbClient = getDb(),
): Promise<void> {
  await db
    .update(users)
    .set({
      signupSource: attribution.source,
      referredByUserId: attribution.referredByUserId,
      signupContext: attribution.context,
    })
    .where(and(eq(users.id, userId), isNull(users.signupSource)));
}

const LINK_LABEL: Record<LinkSource, string> = {
  friend_invite: "friend invite link",
  play_link: "play link",
  list_invite: "list invite",
};

function hostOf(referrer: string | undefined): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function webDetails(ctx: SignupContext): string[] {
  const parts: string[] = [];
  const host = hostOf(ctx.referrer);
  if (host) parts.push(`from ${host}`);
  if (ctx.utm?.source) parts.push(`utm_source=${ctx.utm.source}`);
  if (ctx.utm?.medium) parts.push(`utm_medium=${ctx.utm.medium}`);
  if (ctx.utm?.campaign) parts.push(`utm_campaign=${ctx.utm.campaign}`);
  return parts;
}

/**
 * The "how did they find us" clause of the 👋 signup ping. Pure.
 * `referrerLabel` is the referring user's display label (null when unknown);
 * `platform` is the request's `X-Workshop-Platform` (decides "App Store" vs
 * "direct web visit" wording when nothing was recorded).
 */
export function describeSignupAttribution(
  attribution: SignupAttribution | null,
  referrerLabel: string | null,
  platform: string | null,
): string {
  if (!attribution) return "no referral recorded (app version predates attribution)";
  const { source, context } = attribution;
  const extra = webDetails(context);
  const tail = extra.length > 0 ? ` · ${extra.join(" · ")}` : "";
  if (source === "friend_invite" || source === "play_link" || source === "list_invite") {
    if (!attribution.referredByUserId || !referrerLabel) {
      return `opened a ${LINK_LABEL[source]} that no longer resolves — inviter unknown${tail}`;
    }
    if (source === "play_link") return `via ${referrerLabel}'s play link${tail}`;
    return `invited by ${referrerLabel} (${LINK_LABEL[source]})${tail}`;
  }
  if (source === "web_referral") return extra.join(" · ");
  return platform?.toLowerCase() === "web"
    ? "no referral recorded (direct web visit)"
    : "no referral recorded (App Store / direct)";
}
