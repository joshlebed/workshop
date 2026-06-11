// Lists-surface adapter for the shared `StandingsCard` — one per game in a
// leaderboard list.
//
// Replaces the plain ItemRow on leaderboard lists so the whole standings for
// today read at a glance, without drilling into each game. One card == one
// game; the body taps through to the game-detail day-rail history.
//
// This file owns the Lists-specific data mapping: `Item`/`LeaderboardEntry`
// shapes, the `members` roster denominator, and the per-day turnout / CTA
// copy. The card chrome itself (rank marks, top-N + pinned-you, facepile,
// skeletons, Play CTA) lives in `src/components/StandingsCard.tsx`, shared
// with the Games tab. Both ItemList implementations compose this inside
// their own drag-aware wrappers exactly as they do ItemRow.
//
// Each player's score renders through `summarizeScoreBody` — the SAME distiller
// that builds the "copy today's scores" clipboard recap — so a row's score
// block is identical to what the share copy shows (a hard product
// requirement), grids and all.

import type { Item, LeaderboardEntry, ListMemberSummary } from "@workshop/shared";
import { memo } from "react";
import { StandingsCard, type StandingsRow } from "../../components/StandingsCard";
import { userAvatarImageUrl } from "../../lib/avatar";
import { summarizeScoreBody } from "../../lib/scoresSummary";

export interface GameLeaderboardCardProps {
  item: Item;
  section: "ordered" | "unordered" | "completed";
  isDragging: boolean;
  /** List hue — tints the cover placeholder only (identity, per DESIGN.md). */
  accent: string;
  /**
   * Today's scored players for this game, already server-ranked. Unplayed
   * members are NOT included — the list-scores endpoint only returns rows that
   * have a score — so "who hasn't played" is derived against `members`.
   */
  entries: LeaderboardEntry[];
  /** Full member roster — the "of N" denominator + the dimmed empty facepile. */
  members: ListMemberSummary[];
  selfId: string | null;
  /**
   * Whether the displayed day is today. The day rail can re-date the whole
   * card to a past day; when it does we drop the present-tense "…today"
   * wording and hide the Play / paste CTA (results can only be posted to
   * today's bucket — switch back to Today to play).
   */
  viewingToday?: boolean;
  /** Scores still loading — show skeleton standings, not a 0-turnout card. */
  loading?: boolean;
  /** Tap the title or standings → game detail. */
  onPressBody?: () => void;
  /** Long-press the body → reorder (native only; web drags via the wrapper). */
  onLongPressBody?: () => void;
  onMenu: () => void;
  /** Open the game externally + arm the paste-on-return prompt. */
  onPlay: () => void;
  /** Manual paste fallback — opens the paste sheet without leaving the page. */
  onPaste: () => void;
}

function gameCover(item: Item): { imageUrl: string | null; glyph: string } {
  const c = item.content as Record<string, unknown>;
  const image =
    typeof c.imageProxy === "string"
      ? c.imageProxy
      : typeof c.image === "string"
        ? c.image
        : typeof c.thumbnailUrl === "string"
          ? c.thumbnailUrl
          : null;
  return { imageUrl: image, glyph: "🎮" };
}

function hasScore(entry: LeaderboardEntry): boolean {
  return entry.scoreRaw != null && entry.scoreRaw.length > 0;
}

export const GameLeaderboardCard = memo(function GameLeaderboardCard({
  item,
  isDragging,
  accent,
  entries,
  members,
  selfId,
  viewingToday = true,
  loading,
  onPressBody,
  onLongPressBody,
  onMenu,
  onPlay,
  onPaste,
}: GameLeaderboardCardProps) {
  const cover = gameCover(item);
  // Identical distillation to the clipboard recap: per-game grid, URLs
  // stripped. A URL-only share distills to nothing — the card shows "Played"
  // rather than echo a ref link.
  const rows: StandingsRow[] = entries.filter(hasScore).map((entry) => ({
    userId: entry.userId,
    displayName: entry.displayName,
    avatarUrl: userAvatarImageUrl(entry.userId),
    rank: entry.rank,
    body: summarizeScoreBody(item, entry),
  }));
  const total = members.length;
  const playedCount = rows.length;

  const myEntry = selfId ? entries.find((e) => e.userId === selfId) : undefined;
  const iPlayed = !!(myEntry && hasScore(myEntry));

  const turnout =
    total === 0
      ? "No members yet"
      : playedCount === 0
        ? viewingToday
          ? "No one's played yet"
          : "No one played"
        : playedCount === total
          ? viewingToday
            ? "Everyone's played today"
            : "Everyone played"
          : `${playedCount} of ${total} played${viewingToday ? " today" : ""}`;

  return (
    <StandingsCard
      cardId={item.id}
      title={item.title}
      coverImageUrl={cover.imageUrl}
      coverGlyph={cover.glyph}
      accent={accent}
      isDragging={isDragging}
      turnout={turnout}
      rows={rows}
      selfId={selfId}
      loading={loading}
      emptyFaces={members.map((m) => ({
        userId: m.userId,
        displayName: m.displayName,
        avatarUrl: userAvatarImageUrl(m.userId),
      }))}
      // Past days are read-only — you can't post to a closed bucket.
      showCta={viewingToday && !iPlayed && total > 0}
      onPressBody={onPressBody}
      onLongPressBody={onLongPressBody}
      onMenu={onMenu}
      onPlay={onPlay}
      onPaste={onPaste}
    />
  );
});
