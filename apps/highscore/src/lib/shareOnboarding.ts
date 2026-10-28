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

/**
 * Region of an illustration to ring, as fractions (0–1) of the image's width
 * and height, so the ring stays on target at any rendered size.
 */
export interface IllustrationHighlight {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Annotated screenshots of the real iOS share sheet, one per "how" step. */
export type ShareIllustration = "share-row" | "more-list" | "edit-favorites";

/** One step of the walkthrough. Content only — the screen owns navigation. */
export interface ShareWalkthroughStep {
  title: string;
  body: string;
  /** The share-sheet screenshot that shows where to tap; null on the try-it step. */
  illustration: ShareIllustration | null;
  /** The control to ring on that screenshot. */
  highlight: IllustrationHighlight | null;
  /** Last step: open the real share sheet so the user does it right here. */
  tryIt: boolean;
}

/**
 * The "add HighScore to your share panel" walkthrough: three screenshots of
 * the real share sheet with the control to tap ringed, then a step that opens
 * the share sheet itself. Apple's favorites editor is only reachable from
 * inside a share sheet, so the guide can't deep-link there — it shows the path
 * and then hands the user a live sheet to walk it.
 */
export const SHARE_WALKTHROUGH_STEPS: ShareWalkthroughStep[] = [
  {
    title: "Scroll the app row to More",
    body: "When you finish a game, tap its Share button. In the share sheet, swipe the row of apps all the way left and tap More.",
    illustration: "share-row",
    // The More tile at the end of the app row.
    highlight: { x: 0.5, y: 0.29, width: 0.23, height: 0.31 },
    tryIt: false,
  },
  {
    title: "Tap Edit",
    body: "More lists every app that can take your result. Tap Edit in the top corner.",
    illustration: "more-list",
    highlight: { x: 0.79, y: 0.05, width: 0.185, height: 0.23 },
    tryIt: false,
  },
  {
    title: "Add HighScore to Favorites",
    body: "Tap the green + next to HighScore to move it into Favorites, then tap ✓. It now sits at the front of every share sheet.",
    illustration: "edit-favorites",
    // The green + beside HighScore.
    highlight: { x: 0.075, y: 0.75, width: 0.47, height: 0.2 },
    tryIt: false,
  },
  {
    title: "Your turn",
    body: "Open the share sheet and add HighScore to Favorites. Once it's at the front of the app row, close the sheet.",
    illustration: null,
    highlight: null,
    tryIt: true,
  },
];

/**
 * What the walkthrough's "Open share sheet" button shares. The walkthrough
 * doesn't ask the user to tap HighScore in that sheet (sharing to the app's
 * own extension from inside the app can leave the extension's blank view up
 * until it's swiped away), but if they do, the extension hands this exact
 * text back and the share-intent redirect shows the "it works" screen instead
 * of offering to post it as a score.
 */
export const SHARE_PRACTICE_TEXT = "Testing my HighScore share sheet ✅";

/** Whether a share-intent payload is the walkthrough's practice share. */
export function isSharePractice(text: string | null | undefined): boolean {
  return text?.trim() === SHARE_PRACTICE_TEXT;
}
