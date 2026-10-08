// The candidate picker's rules, kept pure so they can be tested without a
// renderer: when the picker is open, which pick is live, what rides on the
// post, and when a first teach has to ask which way scores rank.
// `useScoreCheck` holds the state and calls these.

import type {
  GameScoreDirection,
  GamesResponse,
  UpsertGameScoreRequest,
} from "@workshop/shared/games";
import {
  type ScoreFeature,
  type ScoreFeatureRole,
  type ScorePick,
  suggestDirectionForFeature,
} from "@workshop/shared/scoreCandidates";
import type { ScoreCheckView } from "./scoreCheck";

/** What the caller adds to the score post, and keeps for the teach call after it. */
export interface ScorePostExtras {
  body: Partial<Omit<UpsertGameScoreRequest, "periodKey" | "scoreRaw">>;
  /** Confirmed by the user for a first teach; passed to `parser/teach` when the post says to. */
  scoreDirection: GameScoreDirection | null;
}

/**
 * Whether teach v2 is on for this account, from the `GET /v1/games` responses
 * already in the query cache. Off when none of them says so — including a
 * server that predates the capability and an account with nothing cached.
 */
export function teachAvailableIn(responses: ReadonlyArray<GamesResponse | undefined>): boolean {
  return responses.some((data) => data?.capabilities?.teach === true);
}

/**
 * Whether a game has a parser according to those same responses: true/false
 * when the game is listed, null when it is not (a share to a game outside My
 * Games) or the server predates the field.
 */
export function listedHasParser(
  responses: ReadonlyArray<GamesResponse | undefined>,
  gameId: string | null | undefined,
): boolean | null {
  if (!gameId) return null;
  for (const data of responses) {
    const listed = data?.games.find((g) => g.gameId === gameId)?.game.hasParser;
    if (listed !== undefined) return listed;
  }
  return null;
}

/**
 * Whether any teach request may be made for this box at all. An account
 * without the capability makes none — not a preview, not a label call.
 */
export function teachRequestsAllowed(input: {
  available: boolean;
  signedIn: boolean;
  gameId: string | null | undefined;
  empty: boolean;
}): boolean {
  return input.available && input.signedIn && !!input.gameId && !input.empty;
}

/** Typing settles for this long before the server is asked. */
const TYPING_DEBOUNCE_MS = 300;
/** A change of more than this many characters at once is a paste, not typing. */
const PASTE_MIN_CHARS = 8;

/**
 * How long to wait before asking the server about a draft. Typing is
 * debounced; a paste — the usual way a result arrives — is one change and is
 * asked about at once.
 */
export function settleDelayMs(previous: string, next: string): number {
  return Math.abs(next.length - previous.length) > PASTE_MIN_CHARS ? 0 : TYPING_DEBOUNCE_MS;
}

/**
 * Whether the server still owes this box something while the chips are up:
 * the dry run (inside its short wait) or the chips' role labels. Drives the
 * "Checking…" note only — the chips are tappable and the post is open
 * throughout.
 */
export function serverPartPending(input: {
  pickerOpen: boolean;
  /** Teach requests are being made for this box at all. */
  offered: boolean;
  previewOut: boolean;
  waitedOut: boolean;
  labelsFetching: boolean;
}): boolean {
  if (!input.pickerOpen || !input.offered) return false;
  return (input.previewOut && !input.waitedOut) || input.labelsFetching;
}

/**
 * Whether the chips are showing. They open by themselves when nothing read
 * the score (or no preview came), on "Not right?", and for Fix score — and
 * once the user has tapped one they stay open whatever the preview says
 * afterwards: a late "Score: 81" must not close the picker over a pick the
 * user just made. A wrong-game question or a text with no result in it comes
 * first either way.
 */
export function pickerIsOpen(input: {
  available: boolean;
  empty: boolean;
  view: ScoreCheckView["kind"];
  /** The user tapped "Not right?". */
  asked: boolean;
  fixing: boolean;
  /** The user tapped a chip (or "I didn't finish"). */
  touched: boolean;
}): boolean {
  if (!input.available || input.empty) return false;
  if (input.view === "wrong_game" || input.view === "no_result_text") return false;
  return (
    input.asked ||
    input.fixing ||
    input.touched ||
    input.view === "unread" ||
    input.view === "no_preview"
  );
}

/**
 * The pick as it stands against the current chips. Chips start as the local
 * computation and are replaced by the server's list when the preview lands;
 * ids are derived from the text alone, so a pick survives the swap. A pick
 * whose candidate is no longer offered is dropped rather than sent.
 */
export function livePick(
  pick: ScorePick | null,
  candidates: readonly ScoreFeature[],
): { pick: ScorePick | null; feature: ScoreFeature | null } {
  if (!pick) return { pick: null, feature: null };
  if (pick.kind === "no_result") return { pick, feature: null };
  const feature = candidates.find((c) => c.id === pick.featureId) ?? null;
  return feature ? { pick, feature } : { pick: null, feature: null };
}

/**
 * The labels' top candidate is pre-selected only while the picker is open
 * and the user has not tapped anything: a tap always wins over the model.
 */
export function shouldPreselect(input: {
  pickerOpen: boolean;
  touched: boolean;
  suggestedId: string | null;
}): boolean {
  return input.pickerOpen && !input.touched && input.suggestedId !== null;
}

/**
 * Which way scores rank, shown for confirmation when this pick would be the
 * game's first teach. `hasParser` is the server's word when there is one
 * (the preview, else the games list); `null` means nobody has said yet — the
 * choice is then shown too, because defaulting silently is the one thing a
 * first teach must not do. Null when there is nothing to confirm.
 */
export function directionToConfirm(input: {
  feature: ScoreFeature | null;
  hasParser: boolean | null;
  chosen: GameScoreDirection | null;
}): GameScoreDirection | null {
  if (!input.feature || input.hasParser === true) return null;
  return input.chosen ?? suggestDirectionForFeature(input.feature);
}

/**
 * What the post carries besides the text. Only ever a candidate's id (or "I
 * didn't finish") — never a value: the server recomputes the candidates from
 * the text and reads the number itself.
 */
export function buildPostExtras(input: {
  pickerOpen: boolean;
  pick: ScorePick | null;
  overrodeRole: ScoreFeatureRole | null;
  previewSeen: boolean;
  /** The other game a wrong-game warning named, once the user chose to post here anyway. */
  postedHereDespite: string | null;
  direction: GameScoreDirection | null;
}): ScorePostExtras {
  const pick = input.pickerOpen ? input.pick : null;
  return {
    body: {
      ...(pick ? { pick } : {}),
      ...(pick && input.overrodeRole ? { overrodeRole: input.overrodeRole } : {}),
      previewSeen: input.previewSeen,
      ...(input.postedHereDespite
        ? { wrongGame: { gameId: input.postedHereDespite, choice: "here" as const } }
        : {}),
    },
    scoreDirection: pick?.kind === "feature" ? input.direction : null,
  };
}
