// Device storage for the score-before-sign-in draft and invite context
// (keys in `inviteStash.ts`, rules in `preloginDraft.ts`). Every read
// validates; every failure reads as "nothing stashed".

import { getItem, removeItem, setItem } from "@workshop/api-client/storage";
import {
  PENDING_FRIEND_INVITE_TOKEN_KEY,
  PENDING_GAME_SHARE_TOKEN_KEY,
  PENDING_INVITE_CONTEXT_KEY,
  PRELOGIN_SCORE_DRAFT_KEY,
} from "./inviteStash";
import {
  type PreloginInviteContext,
  type PreloginScoreDraft,
  parseStoredDraft,
  parseStoredInviteContext,
} from "./preloginDraft";

export async function loadPreloginDraft(): Promise<PreloginScoreDraft | null> {
  return parseStoredDraft(await getItem(PRELOGIN_SCORE_DRAFT_KEY).catch(() => null));
}

export async function savePreloginDraft(draft: PreloginScoreDraft): Promise<void> {
  await setItem(PRELOGIN_SCORE_DRAFT_KEY, JSON.stringify(draft)).catch(() => {});
}

export async function clearPreloginDraft(): Promise<void> {
  await removeItem(PRELOGIN_SCORE_DRAFT_KEY).catch(() => {});
}

export async function saveInviteContext(context: PreloginInviteContext): Promise<void> {
  await setItem(PENDING_INVITE_CONTEXT_KEY, JSON.stringify(context)).catch(() => {});
}

export async function clearInviteContext(): Promise<void> {
  await removeItem(PENDING_INVITE_CONTEXT_KEY).catch(() => {});
}

/**
 * The invite context, only while the link it describes is still the pending
 * one (the post-sign-in resolver will route back to it). A context whose
 * pending token was consumed or replaced is stale and reads as null.
 */
export async function loadLiveInviteContext(now: number): Promise<PreloginInviteContext | null> {
  const context = parseStoredInviteContext(
    await getItem(PENDING_INVITE_CONTEXT_KEY).catch(() => null),
    now,
  );
  if (!context) return null;
  const pendingKey =
    context.linkKind === "play" ? PENDING_GAME_SHARE_TOKEN_KEY : PENDING_FRIEND_INVITE_TOKEN_KEY;
  const pending = await getItem(pendingKey).catch(() => null);
  return pending === context.linkToken ? context : null;
}
