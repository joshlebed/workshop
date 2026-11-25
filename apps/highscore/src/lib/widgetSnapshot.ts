// The home-screen widget's data contract and rules, kept pure so they are
// testable without a renderer or a native module (same shape as
// shareOnboarding.ts). The Swift side is
// apps/highscore/targets/widget/HighScoreWidget.swift — its `Snapshot` struct
// mirrors `WidgetSnapshot` below field for field; change both together and
// bump `WIDGET_SNAPSHOT_VERSION` when a field changes meaning.
//
// Privacy: the snapshot carries game names, counts, and the viewer's own
// posted/not state. Never a friend's name, picture or score — those stay in
// the app (privacy page: scores are shown to friends, in HighScore).

import { USER_FLAG_KEYS } from "@workshop/shared/constants";
import type { GamesResponse } from "@workshop/shared/games";
import { compareReleaseVersions } from "./appRelease";

export const WIDGET_SNAPSHOT_VERSION = 1;
/** Games the widget lists (small and medium both fit four rows). */
export const WIDGET_MAX_GAMES = 4;

export interface WidgetSnapshotGame {
  id: string;
  name: string;
  /** The viewer posted today. */
  you: boolean;
  /** Friends with a score today. */
  played: number;
  /** Friends who have the game in My Games (the "of 5"). */
  friends: number;
}

export interface WidgetSnapshot {
  v: number;
  signedIn: boolean;
  /** The viewer's local day the counts are for (YYYY-MM-DD). */
  day: string;
  games: WidgetSnapshotGame[];
  /** Games beyond the listed ones. */
  more: number;
}

/**
 * The widget's view of today's `GET /v1/games` list: the first four games in
 * My Games order. `friendCount` is absent on older servers; a friend may also
 * have posted without the game in their list, so the "of" is the larger of
 * the two.
 */
export function buildWidgetSnapshot(data: GamesResponse, viewerId: string): WidgetSnapshot {
  const games = data.games.slice(0, WIDGET_MAX_GAMES).map((mg): WidgetSnapshotGame => {
    const friendsPosted = mg.standings.entries.filter((e) => e.userId !== viewerId).length;
    return {
      id: mg.gameId,
      name: mg.game.title,
      you: mg.standings.entries.some((e) => e.userId === viewerId),
      played: friendsPosted,
      friends: Math.max(mg.friendCount ?? 0, friendsPosted),
    };
  });
  return {
    v: WIDGET_SNAPSHOT_VERSION,
    signedIn: true,
    day: data.periodKey,
    games,
    more: Math.max(0, data.games.length - games.length),
  };
}

/** Written on sign-out so the widget never shows the previous account's games. */
export function signedOutWidgetSnapshot(day: string): WidgetSnapshot {
  return { v: WIDGET_SNAPSHOT_VERSION, signedIn: false, day, games: [], more: 0 };
}

// --- Deep links ---------------------------------------------------------------

export type WidgetFamily = "small" | "medium" | "other";

export interface WidgetTap {
  family: WidgetFamily;
  /** The game whose board the tap opened; null = Games home. */
  gameId: string | null;
}

/**
 * `highscore:///games/<id>?src=widget&family=medium` → the tap it records.
 * Anything without `src=widget` is not a widget tap (null).
 */
export function widgetTapFromUrl(url: string | null | undefined): WidgetTap | null {
  if (!url) return null;
  const q = url.indexOf("?");
  if (q < 0) return null;
  const params = new URLSearchParams(url.slice(q + 1).split("#")[0]);
  if (params.get("src") !== "widget") return null;
  const raw = params.get("family");
  const family: WidgetFamily = raw === "small" || raw === "medium" ? raw : "other";
  const path = url.slice(0, q);
  const match = /\/games\/([0-9a-f-]{36})$/i.exec(path);
  return { family, gameId: match?.[1] ?? null };
}

// --- Rollout gate ---------------------------------------------------------------

/** First binary with the widget extension and the ExtensionStorage module. */
export const WIDGET_MIN_RUNTIME = "1.4.0";

/** Kill switch for the in-app entry points (home card, You → Account row). */
export const WIDGET_ENTRY_ENABLED = true;

/** iOS only, and only on a binary that ships the widget extension. */
export function runtimeHasWidget(os: string, runtimeVersion: string | null): boolean {
  if (os !== "ios" || !runtimeVersion) return false;
  const cmp = compareReleaseVersions(runtimeVersion, WIDGET_MIN_RUNTIME);
  return cmp !== null && cmp >= 0;
}

// --- "Add the widget" card ------------------------------------------------------

/** Client-authored value of the `games.widget-card` flag. */
export interface WidgetCardFlagValue {
  shownAt?: string;
  dismissedAt?: string;
}

function cardFlagOf(raw: unknown): WidgetCardFlagValue {
  if (!raw || typeof raw !== "object") return {};
  const value = raw as Record<string, unknown>;
  return {
    shownAt: typeof value.shownAt === "string" ? value.shownAt : undefined,
    dismissedAt: typeof value.dismissedAt === "string" ? value.dismissedAt : undefined,
  };
}

export interface WidgetCardGateInput {
  /** `GET /v1/users/me/flags` payload; `undefined` until it resolves. */
  flags: Record<string, unknown> | undefined;
  /** `runtimeHasWidget` for this binary, and the kill switch. */
  supported: boolean;
  /** The viewer has posted at least one score (today, or a live streak). */
  hasPosted: boolean;
  /** Another Games-home card (share-sheet announcement) is up: wait for it. */
  otherCardVisible: boolean;
}

/**
 * After the first score, once per account: hidden while flags load, after the
 * X, and once a widget is known to be on the home screen.
 */
export function shouldShowWidgetCard(input: WidgetCardGateInput): boolean {
  if (!input.supported || !input.flags || !input.hasPosted || input.otherCardVisible) return false;
  if (input.flags[USER_FLAG_KEYS.widgetInstalled]) return false;
  return !cardFlagOf(input.flags[USER_FLAG_KEYS.widgetCard]).dismissedAt;
}

/** The card rendered for the first time: stamp `shownAt` (kept on later writes). */
export function cardShownFlagValue(previous: unknown, now: Date): WidgetCardFlagValue | null {
  const prev = cardFlagOf(previous);
  return prev.shownAt ? null : { ...prev, shownAt: now.toISOString() };
}

export function cardDismissedFlagValue(previous: unknown, now: Date): WidgetCardFlagValue {
  return { ...cardFlagOf(previous), dismissedAt: now.toISOString() };
}

// --- Install marker -------------------------------------------------------------

/** Client-authored value of the `games.widget-installed` flag (written once). */
export interface WidgetInstalledFlagValue {
  firstSeenAt: string;
  via: "timeline" | "tap";
  family?: string;
}

/** What the widget extension leaves in the App Group when it builds a timeline. */
export interface WidgetMarker {
  timelineAt: string | null;
  families: string[];
}

/** The flag to write, or null when there is nothing new to record. */
export function installedFlagValue(
  flags: Record<string, unknown> | undefined,
  evidence: { marker?: WidgetMarker | null; tap?: WidgetTap | null },
  now: Date,
): WidgetInstalledFlagValue | null {
  if (!flags || flags[USER_FLAG_KEYS.widgetInstalled]) return null;
  if (evidence.tap) {
    return { firstSeenAt: now.toISOString(), via: "tap", family: evidence.tap.family };
  }
  if (evidence.marker?.timelineAt) {
    return {
      firstSeenAt: now.toISOString(),
      via: "timeline",
      family: evidence.marker.families.join(",") || undefined,
    };
  }
  return null;
}

/**
 * Throttle for the `snapshot_write` telemetry: one report per window with the
 * number of writes since the last one, so a busy day is a handful of lines.
 */
export const SNAPSHOT_REPORT_INTERVAL_MS = 30 * 60_000;
