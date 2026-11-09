// Rules for the share-sheet onboarding: the walkthrough that opens itself once
// after sign-in, and the announcement card on the Games home that stays until
// the user deals with it. Kept out of the components so they're testable
// without a renderer (same shape as accountDeletion.ts).
//
// Three signals live on one `games.share-sheet-announcement` flag:
//   onboardedAt — the walkthrough auto-opened once (never auto-opens again)
//   dismissedAt — X on the home card (card gone for good)
//   completedAt — finished the walkthrough (card gone for good)
// A score already posted through the share sheet (`games.share-extension-score`,
// server-authored) ends both the auto-open and the card.

import { USER_FLAG_KEYS } from "@workshop/shared/constants";
import { compareReleaseVersions } from "./appRelease";

/** Client-authored value of the `games.share-sheet-announcement` flag. */
export interface ShareAnnouncementFlagValue {
  /** The walkthrough was auto-opened as an onboarding step at this time. */
  onboardedAt?: string;
  dismissedAt?: string;
  completedAt?: string;
}

function flagValueOf(raw: unknown): ShareAnnouncementFlagValue | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const pick = (key: keyof ShareAnnouncementFlagValue) =>
    typeof value[key] === "string" ? (value[key] as string) : undefined;
  return {
    onboardedAt: pick("onboardedAt"),
    dismissedAt: pick("dismissedAt"),
    completedAt: pick("completedAt"),
  };
}

/**
 * Stamp the auto-open without touching anything else on the flag. The card
 * on the Games home keeps showing after a skipped onboarding — `onboardedAt`
 * is "we showed it", not "they dealt with it".
 */
export function onboardedFlagValue(previous: unknown, now: Date): ShareAnnouncementFlagValue {
  return { ...(flagValueOf(previous) ?? {}), onboardedAt: now.toISOString() };
}

export function dismissedFlagValue(now: Date): ShareAnnouncementFlagValue {
  return { dismissedAt: now.toISOString() };
}

export function completedFlagValue(now: Date): ShareAnnouncementFlagValue {
  return { completedAt: now.toISOString() };
}

/**
 * The binary the share-setup surfaces (announcement card, Edit profile row)
 * ship to. They're JS-only, but the rollout is deliberately 1.2.0+: Store
 * users on 1.0.1 / 1.1.0 get the App Store update nudge first, and see this
 * once they're on 1.2.0. Every OTA still reaches those older runtimes
 * (`supported-runtimes.json`), so this gate is what holds them back.
 */
export const SHARE_SETUP_MIN_RUNTIME = "1.2.0";

/**
 * Kill switch for the share-setup entry points (Games-home card, You → Account
 * row). The `/share-setup` route still renders when linked directly.
 */
export const SHARE_SETUP_ENABLED = true;

/** iOS only (the share sheet is native), and only on a 1.2.0+ binary. */
export function runtimeHasShareSetup(os: string, runtimeVersion: string | null): boolean {
  if (os !== "ios" || !runtimeVersion) return false;
  const cmp = compareReleaseVersions(runtimeVersion, SHARE_SETUP_MIN_RUNTIME);
  return cmp !== null && cmp >= 0;
}

/**
 * Whether to render the announcement card. `flags` is `undefined` until the
 * `GET /v1/users/me/flags` query resolves — never show while loading, so a
 * user who already dismissed it doesn't get a flash of the card. `supported`
 * is `runtimeHasShareSetup` for this binary.
 */
export function shouldShowShareAnnouncement({
  flags,
  supported,
}: {
  flags: Record<string, unknown> | undefined;
  supported: boolean;
}): boolean {
  if (!supported) return false;
  if (flags === undefined) return false;
  // Already dealt with (dismissed or completed the walkthrough)…
  const value = flagValueOf(flags[USER_FLAG_KEYS.shareSheetAnnouncement]);
  if (value?.dismissedAt || value?.completedAt) return false;
  // …or already using the share sheet (server-authored adoption marker).
  if (flags[USER_FLAG_KEYS.shareExtensionScore]) return false;
  return true;
}

/**
 * Whether the Games home should open the walkthrough on its own — the
 * onboarding step. Once per account: any value on the flag (auto-opened,
 * dismissed, or completed) ends it, as does a score already posted through
 * the share sheet. Same no-show-while-loading rule as the card.
 */
export function shouldAutoOpenShareSetup({
  flags,
  supported,
}: {
  flags: Record<string, unknown> | undefined;
  supported: boolean;
}): boolean {
  if (!supported) return false;
  if (flags === undefined) return false;
  if (flags[USER_FLAG_KEYS.shareSheetAnnouncement] !== undefined) return false;
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
    title: "Tap More",
    body: "Tap Share in any game, then scroll the row of apps to the end.",
    illustration: "share-row",
    // The More tile at the end of the app row.
    highlight: { x: 0.5, y: 0.29, width: 0.23, height: 0.31 },
    tryIt: false,
  },
  {
    title: "Tap Edit",
    body: "Top-right corner.",
    illustration: "more-list",
    highlight: { x: 0.79, y: 0.05, width: 0.185, height: 0.23 },
    tryIt: false,
  },
  {
    title: "Tap + next to HighScore",
    body: "Drag it to the top, then tap ✓ twice.",
    illustration: "edit-favorites",
    // The green + beside HighScore.
    highlight: { x: 0.075, y: 0.75, width: 0.47, height: 0.2 },
    tryIt: false,
  },
  {
    title: "Your turn",
    body: "Try it here. Close the sheet when HighScore is at the front of the row.",
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
export const SHARE_PRACTICE_TEXT = "HighScore share test";

/** Whether a share-intent payload is the walkthrough's practice share. */
export function isSharePractice(text: string | null | undefined): boolean {
  return text?.trim() === SHARE_PRACTICE_TEXT;
}
