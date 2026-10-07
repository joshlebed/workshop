import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { GameScoreDirection, GamesResponse, ScoreEntryPoint } from "@workshop/shared/games";
import {
  computeScoreFeatures,
  type ScoreFeature,
  type ScoreFeatureRole,
  type ScorePick,
} from "@workshop/shared/scoreCandidates";
import { useEffect, useMemo, useState } from "react";
import { fetchCandidateLabels, type PreviewAnswer, previewTeachScore } from "../api/teach";
import { useGamesRuntime } from "../runtime";
import {
  blocksPosting,
  resolveScoreCheck,
  roleMismatchCopy,
  type ScoreCheckView,
  sameTextCopy,
} from "./scoreCheck";
import {
  buildPostExtras,
  directionToConfirm,
  listedHasParser,
  livePick,
  pickerIsOpen,
  type ScorePostExtras,
  shouldPreselect,
  teachAvailableIn,
  teachRequestsAllowed,
} from "./scorePicker";

// Typing settles before we ask; a paste (the usual input) waits this once.
const DEBOUNCE_MS = 300;
/** Past this the user can post without the preview (spec §2). */
const PREVIEW_WAIT_MS = 1500;
const MAX_CHIPS = 12;

/**
 * Whether teach v2 is on for this account. Read from the `GET /v1/games`
 * responses already in the query cache, so an account without it makes no
 * extra request to find out — and never calls a teach endpoint.
 */
export function useTeachAvailable(): boolean {
  const queryClient = useQueryClient();
  return teachAvailableIn(
    queryClient.getQueriesData<GamesResponse>({ queryKey: ["games", "mine"] }).map(([, d]) => d),
  );
}

function useListedHasParser(gameId: string | null | undefined): boolean | null {
  const queryClient = useQueryClient();
  return listedHasParser(
    queryClient.getQueriesData<GamesResponse>({ queryKey: ["games", "mine"] }).map(([, d]) => d),
    gameId,
  );
}

export type { ScorePostExtras };

export interface ScoreCheck {
  /** False for an account without teach: render the legacy affordances. */
  available: boolean;
  view: ScoreCheckView;
  /** "This is the same result you posted yesterday. Post anyway?" */
  sameTextWarning: string | null;
  /** The candidate chips are showing. */
  pickerOpen: boolean;
  candidates: ScoreFeature[];
  roles: Record<string, ScoreFeatureRole>;
  pick: ScorePick | null;
  /** "That looks like the puzzle number. Use it anyway?" — waiting on the user. */
  mismatch: { feature: ScoreFeature; copy: string } | null;
  /**
   * Shown once a feature is picked on a game with no parser yet — or when
   * nobody has said yet whether it has one (see `directionToConfirm`).
   */
  direction: GameScoreDirection | null;
  /** False while there is a question the user has to answer first. */
  canPost: boolean;
  openPicker: () => void;
  choose: (feature: ScoreFeature) => void;
  chooseNoResult: () => void;
  confirmMismatch: () => void;
  cancelMismatch: () => void;
  setDirection: (direction: GameScoreDirection) => void;
  /** "Post here anyway" on a wrong-game warning. */
  dismissWrongGame: () => void;
  extras: () => ScorePostExtras;
}

/**
 * Everything the score box shows about a draft for a teach account: the
 * server's dry run, the candidate picker (instant chips, labels when they
 * arrive), and the answers the user has given so far. Nothing here blocks
 * posting for longer than `PREVIEW_WAIT_MS`.
 */
export function useScoreCheck(input: {
  gameId: string | null | undefined;
  text: string;
  periodKey: string;
  entry: ScoreEntryPoint;
  /** The local day, for "yesterday" in the same-text warning. */
  today: string;
  /**
   * "Fix score": the text is already posted here, so the picker is the whole
   * point (open from the start) and a wrong-game match is not asked again.
   */
  fixing?: boolean;
}): ScoreCheck {
  const { gameId, periodKey, entry, today } = input;
  const { token } = useGamesRuntime();
  const available = useTeachAvailable();
  const parserListed = useListedHasParser(gameId);
  const trimmed = input.text.trim();
  const empty = trimmed.length === 0;

  const [settled, setSettled] = useState(trimmed);
  const [waitedOut, setWaitedOut] = useState(false);
  const [pickerAsked, setPickerAsked] = useState(false);
  const [pick, setPick] = useState<ScorePick | null>(null);
  const [touched, setTouched] = useState(false);
  const [overrodeRole, setOverrodeRole] = useState<ScoreFeatureRole | null>(null);
  const [mismatchId, setMismatchId] = useState<string | null>(null);
  const [directionChoice, setDirectionChoice] = useState<GameScoreDirection | null>(null);
  const [wrongGameChosen, setWrongGameDismissed] = useState(false);
  const fixing = input.fixing === true;
  const wrongGameDismissed = wrongGameChosen || fixing;

  // A different text (or game, or day) is a different question: forget the
  // answers given for the last one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on identity change only
  useEffect(() => {
    setWaitedOut(false);
    setPickerAsked(false);
    setPick(null);
    setTouched(false);
    setOverrodeRole(null);
    setMismatchId(null);
    setDirectionChoice(null);
    setWrongGameDismissed(false);
    const debounce = setTimeout(() => setSettled(trimmed), DEBOUNCE_MS);
    const wait = setTimeout(() => setWaitedOut(true), DEBOUNCE_MS + PREVIEW_WAIT_MS);
    return () => {
      clearTimeout(debounce);
      clearTimeout(wait);
    };
  }, [trimmed, gameId, periodKey]);

  const offered = teachRequestsAllowed({ available, signedIn: !!token, gameId, empty });
  const previewQuery = useQuery({
    // Not under ["games"]: posting a score invalidates that prefix.
    queryKey: ["game-score-check", gameId, periodKey, settled],
    queryFn: ({ signal }) =>
      previewTeachScore(gameId ?? "", { scoreRaw: settled, periodKey, entry }, token, signal),
    enabled: offered && settled.length > 0,
    staleTime: 60_000,
    retry: false,
  });
  // Only an answer for the text on screen counts.
  const answer: PreviewAnswer | null | undefined = !offered
    ? undefined
    : settled !== trimmed || previewQuery.isPending
      ? undefined
      : (previewQuery.data ?? null);
  const preview = answer?.kind === "preview" ? answer.preview : null;

  const view = useMemo(
    () =>
      available
        ? resolveScoreCheck({ empty, answer, waitedOut, wrongGameDismissed })
        : ({ kind: "none" } as const),
    [available, empty, answer, waitedOut, wrongGameDismissed],
  );

  // Instant chips from the same function the server runs; the server's list
  // replaces them when it arrives (it also knows the game's zero counts).
  const local = useMemo(
    () => (available && !empty ? computeScoreFeatures(trimmed) : []),
    [available, empty, trimmed],
  );
  const candidates = (preview?.teach?.candidates ?? local).slice(0, MAX_CHIPS);

  const pickerOpen = pickerIsOpen({
    available,
    empty,
    view: view.kind,
    asked: pickerAsked,
    fixing,
    touched,
  });

  const labelsQuery = useQuery({
    queryKey: ["game-score-labels", gameId, settled],
    queryFn: ({ signal }) => fetchCandidateLabels(gameId ?? "", settled, token, signal),
    // Only when the picker is actually open: this is the one model call here.
    enabled: offered && pickerOpen && settled === trimmed && candidates.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const labels = settled === trimmed ? (labelsQuery.data ?? null) : null;
  const roles = labels?.roles ?? {};

  // Pre-select the labels' top candidate — unless the user already tapped.
  const suggestedId = labels?.scoreId ?? null;
  useEffect(() => {
    if (!suggestedId || !shouldPreselect({ pickerOpen, touched, suggestedId })) return;
    setPick({ kind: "feature", featureId: suggestedId });
  }, [pickerOpen, touched, suggestedId]);

  const live = livePick(pick, candidates);
  const picked = live.feature;
  const mismatchFeature = mismatchId ? (candidates.find((c) => c.id === mismatchId) ?? null) : null;
  const mismatchCopy = mismatchFeature ? roleMismatchCopy(roles[mismatchFeature.id]) : null;
  const mismatch =
    mismatchFeature && mismatchCopy ? { feature: mismatchFeature, copy: mismatchCopy } : null;

  // A first teach also says which way scores rank; the user confirms it.
  // The preview knows whether the game has a parser; when it is late, the
  // games list usually does; when neither does, the choice is still shown.
  const direction = pickerOpen
    ? directionToConfirm({
        feature: picked,
        hasParser: preview?.teach ? preview.teach.hasParser : parserListed,
        chosen: directionChoice,
      })
    : null;

  const sameDay = preview?.teach?.sameTextPeriodKey ?? null;

  return {
    available,
    view,
    sameTextWarning: sameDay && view.kind !== "wrong_game" ? sameTextCopy(sameDay, today) : null,
    pickerOpen,
    candidates,
    roles,
    pick: live.pick,
    mismatch,
    direction,
    canPost: !empty && !blocksPosting(view) && !mismatch,
    openPicker: () => setPickerAsked(true),
    choose: (feature) => {
      setTouched(true);
      // Tapping the selected chip again clears it.
      if (pick?.kind === "feature" && pick.featureId === feature.id) {
        setPick(null);
        setOverrodeRole(null);
        return;
      }
      if (roleMismatchCopy(roles[feature.id])) {
        setMismatchId(feature.id);
        return;
      }
      setPick({ kind: "feature", featureId: feature.id });
      setOverrodeRole(null);
    },
    chooseNoResult: () => {
      setTouched(true);
      setMismatchId(null);
      setOverrodeRole(null);
      setPick(pick?.kind === "no_result" ? null : { kind: "no_result" });
    },
    confirmMismatch: () => {
      if (!mismatchFeature) return;
      setPick({ kind: "feature", featureId: mismatchFeature.id });
      setOverrodeRole(roles[mismatchFeature.id] ?? null);
      setMismatchId(null);
    },
    cancelMismatch: () => setMismatchId(null),
    setDirection: setDirectionChoice,
    dismissWrongGame: () => setWrongGameDismissed(true),
    extras: () =>
      buildPostExtras({
        pickerOpen,
        pick: live.pick,
        overrodeRole,
        previewSeen: answer?.kind === "preview",
        postedHereDespite:
          wrongGameChosen && preview?.teach?.wrongGame ? preview.teach.wrongGame.game.id : null,
        direction,
      }),
  };
}
