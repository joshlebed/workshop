// Rules for the one-time share-sheet announcement + walkthrough, kept out of
// the components so they're testable without a renderer (same shape as
// accountDeletion.ts). The announcement is a one-shot blast on the Games home:
// it shows until the user deals with it (X or walkthrough) or proves they
// don't need it (a score already posted through the share sheet).

import { USER_FLAG_KEYS } from "@workshop/shared/constants";

/** Client-authored value of the `games.share-sheet-announcement` flag. */
export interface ShareAnnouncementFlagValue {
  dismissedAt?: string;
  completedAt?: string;
}

export function dismissedFlagValue(now: Date): ShareAnnouncementFlagValue {
  return { dismissedAt: now.toISOString() };
}

export function completedFlagValue(now: Date): ShareAnnouncementFlagValue {
  return { completedAt: now.toISOString() };
}

/**
 * Whether to render the announcement card. `flags` is `undefined` until the
 * `GET /v1/users/me/flags` query resolves — never show while loading, so a
 * user who already dismissed it doesn't get a flash of the card. Only iOS
 * native has a share sheet to set up.
 */
export function shouldShowShareAnnouncement({
  flags,
  isIosNative,
}: {
  flags: Record<string, unknown> | undefined;
  isIosNative: boolean;
}): boolean {
  if (!isIosNative) return false;
  if (flags === undefined) return false;
  // Already dealt with (dismissed or completed the walkthrough)…
  if (flags[USER_FLAG_KEYS.shareSheetAnnouncement]) return false;
  // …or already using the share sheet (server-authored adoption marker).
  if (flags[USER_FLAG_KEYS.shareExtensionScore]) return false;
  return true;
}

/** One step of the walkthrough. Content only — the screen owns navigation. */
export interface ShareWalkthroughStep {
  glyph: string;
  title: string;
  body: string;
}

/**
 * The multi-step "add HighScore to your share panel" walkthrough. Apple's
 * share-sheet management UI is only reachable from inside a share sheet, so
 * the guide walks the user through opening one and pinning HighScore there.
 */
export const SHARE_WALKTHROUGH_STEPS: ShareWalkthroughStep[] = [
  {
    glyph: "🏆",
    title: "Finish a game, tap Share",
    body: "Play any daily game — Wordle, Connections, whatever you love — and tap its Share or Copy results button. The iOS share sheet slides up with your result ready to go.",
  },
  {
    glyph: "🧭",
    title: "Find “More” in the app row",
    body: "In the share sheet, swipe left across the row of app icons all the way to the end and tap “More”. That opens the full list of apps that can receive your result.",
  },
  {
    glyph: "➕",
    title: "Add HighScore to Favorites",
    body: "Tap “Edit” in the top corner, then the green ➕ next to HighScore to add it to Favorites. Drag it near the front so it's always one tap away, then tap “Done”.",
  },
  {
    glyph: "⚡️",
    title: "Post scores in one tap",
    body: "From now on, share a result and tap HighScore — your score posts straight to today's leaderboard. No copying, no switching apps.",
  },
];
