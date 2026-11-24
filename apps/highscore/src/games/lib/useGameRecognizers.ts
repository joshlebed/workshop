import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { GameRecognizer } from "@workshop/shared/gameRecognition";
import type { GamesResponse } from "@workshop/shared/games";
import { useEffect, useMemo, useRef } from "react";
import { deviceCacheGet, deviceCacheRemove, deviceCacheSet } from "../../lib/deviceCache";
import { fetchGameRecognizers } from "../api/recognizers";
import { useGamesRuntime } from "../runtime";
import {
  parseStoredRecognizers,
  RECOGNIZER_CACHE_KEY,
  recognitionCapability,
  recognizersOutOfDate,
  serializeRecognizers,
} from "./localRecognition";
import { loadScoreEngine } from "./scoreEngine";

// Refreshed in the background on app open and focus once this old. A game's
// share layout and a player's list change far more slowly.
const STALE_MS = 30 * 60_000;

/** Forget the stored recognizers — on sign-out, so the next account starts clean. */
export function clearStoredRecognizers(): void {
  deviceCacheRemove(RECOGNIZER_CACHE_KEY);
}

/**
 * This account's recognizers (see `localRecognition.ts`), or null when there
 * are none to use. Read from the device cache at first render — so a share
 * that cold-starts the app is recognized before any request returns — and
 * refreshed from the server in the background, which rewrites the cache.
 *
 * Pass the My Games ids once that list has loaded: a list the recognizers
 * were not built for triggers a refresh right away. Mounted by the Games
 * home (keeps the cache warm) and the share flow (uses it).
 */
export function useGameRecognizers(myGameIds: ReadonlySet<string> | null): GameRecognizer[] | null {
  const { token, user } = useGamesRuntime();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;
  const capability = recognitionCapability(
    queryClient.getQueriesData<GamesResponse>({ queryKey: ["games", "mine"] }).map(([, d]) => d),
  );

  const stored = useMemo(
    () =>
      userId
        ? parseStoredRecognizers(deviceCacheGet(RECOGNIZER_CACHE_KEY), userId, Date.now())
        : null,
    [userId],
  );

  const query = useQuery({
    // Not under ["games"]: posting a score invalidates that prefix, and one
    // more score does not change what a game's shares look like.
    queryKey: ["game-recognizers", userId],
    queryFn: async ({ signal }) => {
      const recognizers = await fetchGameRecognizers(token, signal);
      if (recognizers && userId) {
        deviceCacheSet(RECOGNIZER_CACHE_KEY, serializeRecognizers(userId, recognizers, Date.now()));
      }
      return recognizers;
    },
    enabled: capability === true && !!token && !!userId,
    ...(stored ? { initialData: stored.recognizers, initialDataUpdatedAt: stored.savedAt } : {}),
    staleTime: STALE_MS,
    retry: false,
  });

  // The kill switch: recognition turned off for this account means the
  // stored set goes too, not just the requests.
  useEffect(() => {
    if (capability === false) clearStoredRecognizers();
  }, [capability]);

  // Asked again at most once per My Games list, so a set the server keeps
  // answering the same way cannot loop.
  const refreshedFor = useRef<string | null>(null);
  const { data, isFetching, refetch } = query;
  useEffect(() => {
    if (capability !== true || !data || !myGameIds || isFetching) return;
    if (!recognizersOutOfDate(data, myGameIds)) return;
    const signature = [...myGameIds].sort().join(",");
    if (refreshedFor.current === signature) return;
    refreshedFor.current = signature;
    void refetch();
  }, [capability, data, myGameIds, isFetching, refetch]);

  // Start QuickJS ahead of the share that will need it (~11 ms, once), so a
  // share into a running app reads its score in the first render.
  const usable = capability === false ? null : (data ?? null);
  const hasParsers = usable?.some((r) => r.parser !== null) === true;
  useEffect(() => {
    if (hasParsers) void loadScoreEngine();
  }, [hasParsers]);

  return usable;
}
