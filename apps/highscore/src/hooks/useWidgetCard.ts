// The one-time "Add the widget" card on Games home (rules:
// src/lib/widgetSnapshot.ts → shouldShowWidgetCard). State is the server-side
// `games.widget-card` flag, never local storage, so a reinstall or a second
// device doesn't show it again.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { USER_FLAG_KEYS } from "@workshop/shared/constants";
import type { UserFlagsResponse } from "@workshop/shared/games";
import { useCallback } from "react";
import { fetchUserFlags, putUserFlag } from "../api/release";
import { reportWidgetEvent } from "../api/telemetry";
import { isHomeWidgetSupported } from "../lib/homeWidget";
import {
  cardDismissedFlagValue,
  cardShownFlagValue,
  shouldShowWidgetCard,
  WIDGET_ENTRY_ENABLED,
} from "../lib/widgetSnapshot";
import { useAuth } from "./useAuth";

/** iOS 1.4.0+ binary with the widget, and the kill switch on. */
export function widgetEntrySupported(): boolean {
  return WIDGET_ENTRY_ENABLED && isHomeWidgetSupported();
}

export function useWidgetCard({
  hasPosted,
  otherCardVisible,
}: {
  hasPosted: boolean;
  otherCardVisible: boolean;
}) {
  const { token, status, impersonation } = useAuth();
  const queryClient = useQueryClient();
  const supported = widgetEntrySupported() && impersonation === null;

  const flagsQuery = useQuery({
    queryKey: queryKeys.users.flags,
    queryFn: () => fetchUserFlags(token),
    enabled: supported && status === "signed-in" && Boolean(token),
    staleTime: 5 * 60_000,
  });
  const flags = flagsQuery.data?.flags;

  const writeFlag = useMutation({
    mutationFn: (value: unknown) => putUserFlag(token, USER_FLAG_KEYS.widgetCard, value),
    // Optimistic: a failed write only brings the card back on the next fetch.
    onMutate: (value) => {
      queryClient.setQueryData<UserFlagsResponse>(queryKeys.users.flags, (prev) => ({
        flags: { ...(prev?.flags ?? {}), [USER_FLAG_KEYS.widgetCard]: value },
      }));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.users.flags }),
  });
  const { mutate } = writeFlag;

  const markShown = useCallback(() => {
    const value = cardShownFlagValue(flags?.[USER_FLAG_KEYS.widgetCard], new Date());
    void reportWidgetEvent({ event: "card_shown", source: "home-card" }, token);
    if (value) mutate(value);
  }, [flags, mutate, token]);

  const dismiss = useCallback(() => {
    void reportWidgetEvent({ event: "card_dismissed", source: "home-card" }, token);
    mutate(cardDismissedFlagValue(flags?.[USER_FLAG_KEYS.widgetCard], new Date()));
  }, [flags, mutate, token]);

  const visible = shouldShowWidgetCard({ flags, supported, hasPosted, otherCardVisible });
  return { visible, markShown, dismiss };
}
