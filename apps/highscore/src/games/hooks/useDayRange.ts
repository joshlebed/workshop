// The last N days of `GET /v1/games`, one cached query per day. Home pages
// through these when you step back a day, the box score builds its 7-day
// strip from them, and the profile's form strip reads the same cache — so a
// week of history costs seven small requests once, then nothing.
//
// TODO(api): a `GET /v1/games/history?days=7` would make this one round trip.

import { useQueries } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { GamesResponse } from "@workshop/shared/games";
import { useMemo } from "react";
import { fetchMyGames } from "../api/games";
import { recentDays } from "../lib/gameDate";
import { useGamesRuntime } from "../runtime";

export const DAY_RANGE_LENGTH = 7;

export interface DayRangeEntry {
  date: string;
  data: GamesResponse | undefined;
  isPending: boolean;
}

export function useDayRange(today: string, length = DAY_RANGE_LENGTH): DayRangeEntry[] {
  const { token } = useGamesRuntime();
  const days = useMemo(() => recentDays(today, length), [today, length]);
  const queries = useQueries({
    queries: days.map((date) => ({
      queryKey: queryKeys.games.mine(date),
      queryFn: () => fetchMyGames(date, token),
      enabled: !!token,
      // History doesn't move; today's query (owned by home) sets its own polling.
      staleTime: date === today ? 0 : 5 * 60_000,
    })),
  });
  // Seven small objects per render — cheaper than memoising over a hook
  // result that is a fresh array every render anyway.
  return days.map((date, i) => ({
    date,
    data: queries[i]?.data,
    isPending: queries[i]?.isPending ?? true,
  }));
}
