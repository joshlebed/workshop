// Score before sign-in (onboarding spike 1): the pure rules for a score a
// signed-out visitor pastes on an invite landing (`/g/:token`,
// `/friends/accept/:token`). The draft lives only on the device until sign-in;
// the landing then posts it with the normal authenticated upsert. Storage and
// telemetry are in `preloginDraftStore.ts`; nothing here touches either.

import {
  formatShareBodyFallback,
  type GameKey,
  gameDefinitionForKey,
} from "@workshop/shared/gameRegistry";
import { formatScoreValue } from "@workshop/shared/games";
import { parseScoreWithSpec } from "@workshop/shared/scoreParsing";
import { z } from "zod";
import { detectSharedScore, isResultlessShare } from "./shareScoreDetection";

export type InviteLinkKind = "play" | "friend";

/** Longest paste we keep — SecureStore warns past ~2KB per value. */
export const PRELOGIN_DRAFT_MAX_CHARS = 1000;

/** The context stash is ignored after this long (a link opened days ago). */
export const INVITE_CONTEXT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** What the landing shows under the paste box for the current text. */
export type DraftReading =
  | { kind: "empty" }
  /** A bare link / hashtag with no result in it. */
  | { kind: "resultless"; gameTitle: string | null }
  /** Text, but no known game's share pattern matched. */
  | { kind: "unrecognized" }
  | {
      kind: "recognized";
      gameKey: GameKey;
      gameTitle: string;
      canonicalUrl: string;
      /** The score as the board will show it (`937`, `0:42`), when the spec reads one. */
      scoreDisplay: string | null;
      /** The compact share block (grid / score line), when there is one. */
      summary: string | null;
    };

/** Read pasted text locally — the same registry the post screens use. */
export function readDraftText(raw: string | null | undefined): DraftReading {
  const text = raw?.trim() ?? "";
  if (!text) return { kind: "empty" };
  const detection = detectSharedScore(text);
  if (isResultlessShare(text)) {
    return { kind: "resultless", gameTitle: detection?.gameLabel ?? null };
  }
  if (!detection) return { kind: "unrecognized" };
  const def = gameDefinitionForKey(detection.kind);
  if (!def) return { kind: "unrecognized" };
  const value = def.spec ? parseScoreWithSpec(def.spec, text) : null;
  return {
    kind: "recognized",
    gameKey: def.key,
    gameTitle: def.title,
    canonicalUrl: def.canonicalUrl,
    scoreDisplay: value === null ? null : formatScoreValue(value, def.scoreUnit),
    summary: def.formatShareBody?.(text) ?? formatShareBodyFallback(text),
  };
}

const linkKindSchema = z.enum(["play", "friend"]);

const inviteContextSchema = z.object({
  v: z.literal(1),
  linkKind: linkKindSchema,
  linkToken: z.string().min(1).max(64),
  inviterName: z.string().max(80).nullable(),
  inviterId: z.string().max(64),
  savedAt: z.number(),
});
export type PreloginInviteContext = z.infer<typeof inviteContextSchema>;

const draftSchema = z.object({
  v: z.literal(1),
  /** Random id that joins the telemetry lines of one draft across sign-in. */
  id: z.string().min(1).max(64),
  linkKind: linkKindSchema,
  linkToken: z.string().min(1).max(64),
  gameKey: z.string().min(1).max(64),
  gameTitle: z.string().min(1).max(120),
  canonicalUrl: z.string().min(1).max(500),
  scoreRaw: z.string().min(1).max(PRELOGIN_DRAFT_MAX_CHARS),
  /** The visitor's local day when they pasted — the day the post is for. */
  periodKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  createdAt: z.number(),
  /** Whether the sharer played the same game that day (play links only). */
  sharerPlayed: z.boolean().optional(),
});
export type PreloginScoreDraft = z.infer<typeof draftSchema>;

function parseJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** A stored draft, or null for nothing / anything malformed. */
export function parseStoredDraft(raw: string | null | undefined): PreloginScoreDraft | null {
  const parsed = draftSchema.safeParse(parseJson(raw));
  return parsed.success ? parsed.data : null;
}

/** A stored invite context, or null for nothing / malformed / too old. */
export function parseStoredInviteContext(
  raw: string | null | undefined,
  now: number,
): PreloginInviteContext | null {
  const parsed = inviteContextSchema.safeParse(parseJson(raw));
  if (!parsed.success) return null;
  if (now - parsed.data.savedAt > INVITE_CONTEXT_MAX_AGE_MS) return null;
  return parsed.data;
}

/** Build the draft to stash for a recognised reading, or null when there is nothing to keep. */
export function buildDraft(input: {
  id: string;
  text: string;
  reading: DraftReading;
  linkKind: InviteLinkKind;
  linkToken: string;
  periodKey: string;
  now: number;
  sharerGames?: readonly string[];
}): PreloginScoreDraft | null {
  const { reading } = input;
  if (reading.kind !== "recognized") return null;
  const scoreRaw = input.text.trim().slice(0, PRELOGIN_DRAFT_MAX_CHARS);
  if (!scoreRaw) return null;
  return {
    v: 1,
    id: input.id,
    linkKind: input.linkKind,
    linkToken: input.linkToken,
    gameKey: reading.gameKey,
    gameTitle: reading.gameTitle,
    canonicalUrl: reading.canonicalUrl,
    scoreRaw,
    periodKey: input.periodKey,
    createdAt: input.now,
    ...(input.linkKind === "play"
      ? { sharerPlayed: sharerPlayedGame(reading.gameTitle, input.sharerGames ?? []) }
      : {}),
  };
}

/** Case-insensitive title match against the sharer's games that day. */
export function sharerPlayedGame(gameTitle: string, sharerGames: readonly string[]): boolean {
  const want = gameTitle.trim().toLowerCase();
  return sharerGames.some((title) => title.trim().toLowerCase() === want);
}

/**
 * What to do with a stashed draft on a landing for `linkKind` / `linkToken`
 * on local day `today`:
 *   - `use`: it belongs to this link and today — prefill / post it.
 *   - `expired`: it was pasted on another day; a daily score can't be posted
 *     to a day that has passed, so drop it (an abandoned draft).
 *   - `other-link`: it belongs to a different link; leave it alone.
 */
export function draftDisposition(
  draft: PreloginScoreDraft | null,
  linkKind: InviteLinkKind,
  linkToken: string,
  today: string,
): "none" | "use" | "expired" | "other-link" {
  if (!draft) return "none";
  if (draft.periodKey !== today) return "expired";
  if (draft.linkKind !== linkKind || draft.linkToken !== linkToken) return "other-link";
  return "use";
}

/** The sign-in screen's header for a visitor who came from an invite. */
export function signInContextCopy(
  context: PreloginInviteContext,
  draft: PreloginScoreDraft | null,
): { title: string; caption: string } {
  const name = context.inviterName?.trim() || "A friend";
  const title = `${name} invited you`;
  if (draft && draft.linkToken === context.linkToken && draft.linkKind === context.linkKind) {
    return { title, caption: `Sign in to save your ${draft.gameTitle} score.` };
  }
  return {
    title,
    caption:
      context.linkKind === "play"
        ? `Sign in to compare scores with ${name === "A friend" ? "them" : name}.`
        : `Sign in to add ${name === "A friend" ? "them" : name} as a friend.`,
  };
}

/** The path back to the invite a context or draft came from. */
export function invitePath(linkKind: InviteLinkKind, linkToken: string): string {
  const token = encodeURIComponent(linkToken);
  return linkKind === "play" ? `/g/${token}` : `/friends/accept/${token}`;
}

/** A short random id for a draft (telemetry join key, not a secret). */
export function newDraftId(random: () => number = Math.random): string {
  let id = "d_";
  for (let i = 0; i < 12; i++) id += Math.floor(random() * 36).toString(36);
  return id;
}
