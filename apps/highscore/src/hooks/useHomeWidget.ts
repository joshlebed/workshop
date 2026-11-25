// Keeps the iOS home-screen widget in step with the app (rules:
// src/lib/widgetSnapshot.ts; native door: src/lib/homeWidget.ts). Mounted once,
// in the root AuthGate. No-ops on web, Android and pre-1.4.0 binaries.
//
//   - Snapshot: every time today's `GET /v1/games` list lands in the query
//     cache — a fetch, a refetch, or `writePostedScore` after a post — the
//     widget gets the new snapshot (skipped when nothing changed).
//   - Sign-out writes an empty, signed-out snapshot.
//   - Install marker: on launch and on every foreground, if the widget has
//     built a timeline (it leaves `widget.timelineAt` in the App Group), the
//     account gets the `games.widget-installed` flag once.
//   - Taps: a `?src=widget` deep link reports `widget_tap` (and is install
//     evidence on its own).
// Never while impersonating: the device and its widget belong to the real
// account.

import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { USER_FLAG_KEYS } from "@workshop/shared/constants";
import type { GamesResponse, UserFlagsResponse } from "@workshop/shared/games";
import * as Linking from "expo-linking";
import * as Updates from "expo-updates";
import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { fetchUserFlags, putUserFlag } from "../api/release";
import { reportWidgetEvent } from "../api/telemetry";
import { localDateKey } from "../games/lib/gameDate";
import { isHomeWidgetSupported, readWidgetMarker, writeWidgetSnapshot } from "../lib/homeWidget";
import {
  buildWidgetSnapshot,
  installedFlagValue,
  SNAPSHOT_REPORT_INTERVAL_MS,
  signedOutWidgetSnapshot,
  type WidgetTap,
  widgetTapFromUrl,
} from "../lib/widgetSnapshot";
import { useAuth } from "./useAuth";

const runtime = () => ({
  runtimeVersion: Updates.runtimeVersion ?? null,
  updateId: Updates.updateId ?? null,
});

export function useHomeWidget() {
  const { status, token, user, impersonation } = useAuth();
  const queryClient = useQueryClient();
  const supported = isHomeWidgetSupported();
  const active = supported && status === "signed-in" && !!token && !!user && !impersonation;
  const viewerId = user?.id ?? null;

  // --- Snapshot writes ------------------------------------------------------
  const lastWritten = useRef<string | null>(null);
  const pendingWrites = useRef(0);
  const lastReportAt = useRef(0);

  useEffect(() => {
    if (!active || !viewerId) return;
    const write = (data: GamesResponse | undefined) => {
      if (!data || data.periodKey !== localDateKey()) return;
      const snapshot = buildWidgetSnapshot(data, viewerId);
      const json = JSON.stringify(snapshot);
      if (json === lastWritten.current) return;
      if (!writeWidgetSnapshot(snapshot)) return;
      lastWritten.current = json;
      pendingWrites.current += 1;
      const now = Date.now();
      if (now - lastReportAt.current < SNAPSHOT_REPORT_INTERVAL_MS) return;
      lastReportAt.current = now;
      const writes = pendingWrites.current;
      pendingWrites.current = 0;
      void reportWidgetEvent(
        {
          event: "snapshot_write",
          writes,
          gameCount: snapshot.games.length,
          playedCount: snapshot.games.filter((g) => g.you).length,
          ...runtime(),
        },
        token,
      );
    };
    // What's already cached (a warm start), then every later update.
    write(queryClient.getQueryData<GamesResponse>(queryKeys.games.mine(localDateKey())));
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") return;
      const key = event.query.queryKey;
      if (key[0] !== "games" || key[1] !== "mine" || key[2] !== localDateKey()) return;
      write(event.query.state.data as GamesResponse | undefined);
    });
  }, [active, viewerId, queryClient, token]);

  // Signed out: the widget must not keep showing the last account's games.
  useEffect(() => {
    if (!supported || status !== "signed-out") return;
    lastWritten.current = null;
    writeWidgetSnapshot(signedOutWidgetSnapshot(localDateKey()));
  }, [supported, status]);

  // --- Install marker + taps --------------------------------------------------
  const recording = useRef(false);
  const initialUrlHandled = useRef(false);

  const record = useCallback(
    async (tap: WidgetTap | null) => {
      if (recording.current) return;
      recording.current = true;
      try {
        const marker = tap ? null : readWidgetMarker();
        if (!tap && !marker) return;
        const flags = await queryClient.fetchQuery({
          queryKey: queryKeys.users.flags,
          queryFn: () => fetchUserFlags(token),
          staleTime: 5 * 60_000,
        });
        const value = installedFlagValue(flags.flags, { marker, tap }, new Date());
        if (!value) return;
        await putUserFlag(token, USER_FLAG_KEYS.widgetInstalled, value);
        queryClient.setQueryData<UserFlagsResponse>(queryKeys.users.flags, (prev) => ({
          flags: { ...(prev?.flags ?? {}), [USER_FLAG_KEYS.widgetInstalled]: value },
        }));
        if (value.via === "timeline") {
          void reportWidgetEvent(
            { event: "widget_seen", family: value.family, ...runtime() },
            token,
          );
        }
      } catch {
        // Best effort: the next foreground tries again.
      } finally {
        recording.current = false;
      }
    },
    [queryClient, token],
  );

  useEffect(() => {
    if (!active) return;
    const onUrl = (url: string | null) => {
      const tap = widgetTapFromUrl(url);
      if (!tap) return;
      void reportWidgetEvent(
        {
          event: "widget_tap",
          family: tap.family,
          ...(tap.gameId ? { gameId: tap.gameId } : {}),
          ...runtime(),
        },
        token,
      );
      void record(tap);
    };
    // A tap that cold-started the app arrived before sign-in resolved.
    if (!initialUrlHandled.current) {
      initialUrlHandled.current = true;
      Linking.getInitialURL()
        .then(onUrl)
        .catch(() => {});
    }
    const urlSub = Linking.addEventListener("url", (e) => onUrl(e.url));
    void record(null);
    const appSub = AppState.addEventListener("change", (next) => {
      if (next === "active") void record(null);
    });
    return () => {
      urlSub.remove();
      appSub.remove();
    };
  }, [active, record, token]);
}
