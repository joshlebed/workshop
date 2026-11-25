// Data + side effects for the day-1 "Get set up" card (rules:
// src/lib/setupChecklist.ts). Everything comes from queries the client
// already makes — `GET /v1/games` (passed in), `GET /v1/friends`,
// `GET /v1/users/me/flags`, `GET /v1/me/notification-prefs` and the OS push
// permission — so the card needs no endpoint of its own. The only write is the
// `games.setup-checklist` user flag; events go to the log-only
// `POST /v1/telemetry/setup-checklist`.
//
// Nothing here runs for an account past its first 48h (unless it is still
// showing "You're set"), and nothing is written or reported while an admin
// impersonates someone.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchFriends } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import { type SetupChecklistRowId, USER_FLAG_KEYS } from "@workshop/shared/constants";
import type { MyGame, UserFlagsResponse } from "@workshop/shared/games";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { fetchNotificationPrefs } from "../api/notifications";
import { fetchUserFlags, putUserFlag } from "../api/release";
import { reportSetupChecklist, type SetupChecklistTelemetry } from "../api/telemetry";
import {
  getPermissionStatus,
  isPushSupported,
  type PushPermissionStatus,
} from "../lib/pushNotifications";
import {
  deriveSetupRows,
  inSetupWindow,
  mergeSetupFlag,
  minutesSinceSignup,
  newlyDoneRows,
  type SetupCardState,
  type SetupChecklistFlagValue,
  setupCardState,
  setupFlagFrom,
} from "../lib/setupChecklist";
import { useAuth } from "./useAuth";
import { SHARE_SETUP_SUPPORTED } from "./useShareAnnouncement";

/** Events already reported this JS session, per user (`shown` once per launch). */
const reportedThisSession = new Set<string>();

function usePushPermission(enabled: boolean): PushPermissionStatus | null {
  const [status, setStatus] = useState<PushPermissionStatus | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => void getPermissionStatus().then(setStatus);
    refresh();
    // Re-read on return from iOS Settings or the OS dialog.
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh();
    });
    return () => sub.remove();
  }, [enabled]);
  return status;
}

export interface SetupChecklist {
  state: SetupCardState;
  onRowTap: (row: SetupChecklistRowId) => void;
  dismiss: () => void;
  /** "Got it" on "You're set". */
  acknowledge: () => void;
}

export function useSetupChecklist({ games }: { games: MyGame[] | undefined }): SetupChecklist {
  const { token, user, status, impersonation } = useAuth();
  const queryClient = useQueryClient();
  const livePoll = useLivePollingInterval();
  const signedUpAt = user?.createdAt ?? null;
  const signedIn = status === "signed-in" && Boolean(token) && impersonation === null;

  const flagsQuery = useQuery({
    queryKey: queryKeys.users.flags,
    queryFn: () => fetchUserFlags(token),
    enabled: signedIn,
    staleTime: 5 * 60_000,
  });
  const flags = flagsQuery.data?.flags;
  const flag = useMemo<SetupChecklistFlagValue | null>(
    () => (flags ? setupFlagFrom(flags) : null),
    [flags],
  );

  const now = new Date();
  // Only accounts that can still see the card pay for its queries.
  const active =
    signedIn &&
    signedUpAt !== null &&
    flag !== null &&
    !flag.dismissedAt &&
    !flag.retiredAt &&
    (inSetupWindow(signedUpAt, now) || Boolean(flag.completedAt));

  const friendsQuery = useQuery({
    queryKey: queryKeys.friends.all,
    queryFn: () => fetchFriends(token),
    enabled: active,
    refetchInterval: active ? livePoll : false,
  });

  const pushSupported = isPushSupported();
  const permission = usePushPermission(active && pushSupported);
  const prefsQuery = useQuery({
    queryKey: queryKeys.users.notificationPrefs,
    queryFn: () => fetchNotificationPrefs(token),
    enabled: active && pushSupported,
  });

  const rows = useMemo(() => {
    if (!flags || !flag) return null;
    const shareScore = Boolean(flags[USER_FLAG_KEYS.shareExtensionScore]);
    const shareAnnouncement = flags[USER_FLAG_KEYS.shareSheetAnnouncement] as
      | { completedAt?: unknown }
      | undefined;
    const reminderEnabled = prefsQuery.data?.playReminderEnabled;
    return deriveSetupRows(
      {
        friendsSince: friendsQuery.data?.friends.map((f) => f.friendsSince),
        gamesAddedAt: games?.map((g) => g.addedAt),
        hasScore: games
          ? shareScore ||
            games.some((g) => g.standings.viewerHasPlayed || g.standings.viewerStreak > 0)
          : undefined,
        shareSheet: SHARE_SETUP_SUPPORTED
          ? {
              applicable: true,
              done: shareScore || typeof shareAnnouncement?.completedAt === "string",
            }
          : { applicable: false },
        // Denied in iOS Settings and not already on: the app can't finish
        // this row, so it drops out instead of blocking "You're set".
        reminder:
          !pushSupported || (permission === "denied" && reminderEnabled !== true)
            ? { applicable: false }
            : {
                applicable: true,
                done: permission === null ? undefined : reminderEnabled,
              },
      },
      flag,
    );
  }, [flag, flags, friendsQuery.data, games, prefsQuery.data, permission, pushSupported]);

  const state = setupCardState({ signedUpAt, now, flag, rows });

  // ---- writes -------------------------------------------------------------

  // Fields are only ever added, so merging what we last wrote over the cache
  // keeps a refetch that lands mid-write from dropping one.
  const latestRef = useRef<SetupChecklistFlagValue>({});
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const writeFlag = useCallback(
    (patch: SetupChecklistFlagValue) => {
      if (!signedIn) return;
      const cached = setupFlagFrom(
        queryClient.getQueryData<UserFlagsResponse>(queryKeys.users.flags)?.flags ?? {},
      );
      const next = mergeSetupFlag(mergeSetupFlag(cached, latestRef.current), patch);
      latestRef.current = next;
      queryClient.setQueryData<UserFlagsResponse>(queryKeys.users.flags, (prev) => ({
        flags: { ...(prev?.flags ?? {}), [USER_FLAG_KEYS.setupChecklist]: next },
      }));
      chainRef.current = chainRef.current
        .then(() => putUserFlag(token, USER_FLAG_KEYS.setupChecklist, next))
        .catch(() => {
          /* the next fetch shows the truth; a lost stamp re-records later */
        });
    },
    [queryClient, signedIn, token],
  );

  const report = useCallback(
    (body: Omit<SetupChecklistTelemetry, "platform">, onceKey?: string) => {
      if (!signedIn || !user) return;
      if (onceKey) {
        const key = `${user.id}:${onceKey}`;
        if (reportedThisSession.has(key)) return;
        reportedThisSession.add(key);
      }
      void reportSetupChecklist({ ...body, platform: Platform.OS }, token);
    },
    [signedIn, token, user],
  );

  const minutes = useCallback(
    (at: string | Date = new Date()) => (signedUpAt ? minutesSinceSignup(signedUpAt, at) : 0),
    [signedUpAt],
  );

  const kind = state.kind;
  const hiddenReason = state.kind === "hidden" ? state.reason : null;
  const doneCount = rows?.filter((r) => r.done).length ?? 0;
  const total = rows?.length ?? 0;

  // Shown: once per launch to the log, once ever on the flag.
  useEffect(() => {
    if (kind !== "checklist" && kind !== "celebrate") return;
    report({ event: "shown", doneCount, total, minutesSinceSignup: minutes() }, "shown");
    if (!flag?.shownAt) writeFlag({ shownAt: new Date().toISOString() });
  }, [kind, doneCount, total, flag?.shownAt, minutes, report, writeFlag]);

  // Row completions: recorded while the card can still show, with the data's
  // own timestamp when it has one (friendship, game added), else first seen.
  const newlyDone = rows && flag && active ? newlyDoneRows(rows, flag, now) : [];
  const newlyKey = newlyDone.map((r) => r.id).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the ids
  useEffect(() => {
    if (newlyDone.length === 0) return;
    const fresh = newlyDone.filter((r) => !latestRef.current.rows?.[r.id]);
    if (fresh.length === 0) return;
    writeFlag({ rows: Object.fromEntries(fresh.map((r) => [r.id, r.at])) });
    for (const r of fresh) {
      report(
        { event: "row_completed", row: r.id, minutesSinceSignup: minutes(r.at) },
        `row:${r.id}`,
      );
    }
  }, [newlyKey]);

  // Everything done: stamp the moment "You're set" first shows.
  useEffect(() => {
    if (kind !== "celebrate" || flag?.completedAt || latestRef.current.completedAt) return;
    writeFlag({ completedAt: new Date().toISOString() });
    report({ event: "completed", total, minutesSinceSignup: minutes() }, "completed");
  }, [kind, flag?.completedAt, total, minutes, report, writeFlag]);

  // Retire: the celebration ran out, or the window closed on a card that was shown.
  useEffect(() => {
    if (!flag || flag.retiredAt || flag.dismissedAt || latestRef.current.retiredAt) return;
    const reason =
      hiddenReason === "celebrated"
        ? "completed"
        : hiddenReason === "expired" && flag.shownAt
          ? "expired"
          : null;
    if (!reason) return;
    writeFlag({ retiredAt: new Date().toISOString(), retiredReason: reason });
    report({ event: "retired", reason, doneCount, total }, "retired");
  }, [hiddenReason, flag, doneCount, total, report, writeFlag]);

  const onRowTap = useCallback(
    (row: SetupChecklistRowId) =>
      report({ event: "row_tapped", row, minutesSinceSignup: minutes() }),
    [minutes, report],
  );

  const dismiss = useCallback(() => {
    writeFlag({ dismissedAt: new Date().toISOString() });
    report({ event: "dismissed", doneCount, total, minutesSinceSignup: minutes() }, "dismissed");
  }, [doneCount, total, minutes, report, writeFlag]);

  const acknowledge = useCallback(() => {
    writeFlag({ retiredAt: new Date().toISOString(), retiredReason: "completed" });
    report({ event: "retired", reason: "completed", doneCount, total }, "retired");
  }, [doneCount, total, report, writeFlag]);

  return { state, onRowTap, dismiss, acknowledge };
}
