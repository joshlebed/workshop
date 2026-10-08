// The day spine's data: `GET /v1/games?period=` for the selected day plus the
// six other days in the strip window. The window is fetched with a long
// staleTime so stepping between days is instant once loaded, and only the
// selected day polls (and only when it is today).
import { type UseQueryResult, useQueries, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import type { GamesResponse, MyGame } from "@workshop/shared/games";
import { useMemo } from "react";
import { spineWindow } from "../../day/spine";
import { fetchMyGames } from "../api/games";
import { scoredEntries } from "../lib/dayRows";
import { localDateKey } from "../lib/gameDate";
import { useGamesRuntime } from "../runtime";

const WINDOW_STALE_MS = 5 * 60_000;

// Stable `combine` so useQueries hands back a referentially-stable array of
// payloads (an inline combine would defeat the memo below).
function combineData(results: UseQueryResult<GamesResponse>[]): (GamesResponse | undefined)[] {
  return results.map((r) => r.data);
}

export interface DayWindow {
  today: string;
  /** The selected day's games (the user's rotation + that day's standings). */
  day: ReturnType<typeof useQuery<GamesResponse>>;
  /** Days in the strip window the viewer posted on. */
  playedDays: ReadonlySet<string>;
  /** Days in the strip window anyone in the circle posted on. */
  activeDays: ReadonlySet<string>;
  /** The window's responses by day, for callers that want history (profile grid). */
  byDay: ReadonlyMap<string, GamesResponse>;
}

export function useDayWindow(viewDate: string): DayWindow {
  const { token } = useGamesRuntime();
  const today = localDateKey();
  const livePoll = useLivePollingInterval();
  const viewingToday = viewDate === today;

  const day = useQuery({
    queryKey: queryKeys.games.mine(viewDate),
    queryFn: () => fetchMyGames(viewDate, token),
    enabled: !!token,
    refetchInterval: viewingToday ? livePoll : false,
  });

  // Today is always in the map: it carries the user's current rotation (the
  // rows' titles and order) even when the strip has slid back weeks.
  const window = spineWindow(viewDate, today);
  const extra = window.includes(today) ? window : [...window, today];
  const others = useQueries({
    queries: extra
      .filter((date) => date !== viewDate)
      .map((date) => ({
        queryKey: queryKeys.games.mine(date),
        queryFn: () => fetchMyGames(date, token),
        enabled: !!token,
        staleTime: WINDOW_STALE_MS,
      })),
    combine: combineData,
  });

  const { playedDays, activeDays, byDay } = useMemo(() => {
    const played = new Set<string>();
    const active = new Set<string>();
    const map = new Map<string, GamesResponse>();
    const responses = [day.data, ...others];
    for (const response of responses) {
      if (!response) continue;
      map.set(response.periodKey, response);
      for (const game of response.games) {
        const entries = scoredEntries(game.standings.entries);
        if (entries.length > 0) active.add(response.periodKey);
        if (game.standings.viewerHasPlayed) played.add(response.periodKey);
      }
    }
    return { playedDays: played, activeDays: active, byDay: map };
  }, [day.data, others]);

  return { today, day, playedDays, activeDays, byDay };
}

/** The games list in the user's order, from whichever day has loaded first. */
export function rotationFrom(
  byDay: ReadonlyMap<string, GamesResponse>,
  preferred: string,
): MyGame[] {
  return byDay.get(preferred)?.games ?? byDay.values().next().value?.games ?? [];
}
