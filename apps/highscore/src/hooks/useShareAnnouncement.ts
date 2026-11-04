// The one-time share-sheet announcement on Games home, and whether this
// binary gets the share-setup surfaces at all (rules: src/lib/shareOnboarding.ts).
// Dismissal is a `user_flags` row, never localStorage, so a reinstall or a
// second device doesn't re-blast it.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { USER_FLAG_KEYS } from "@workshop/shared/constants";
import type { UserFlagsResponse } from "@workshop/shared/games";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { useCallback } from "react";
import { Platform } from "react-native";
import { fetchUserFlags, putUserFlag } from "../api/release";
import {
  dismissedFlagValue,
  runtimeHasShareSetup,
  SHARE_SETUP_ENABLED,
  shouldShowShareAnnouncement,
} from "../lib/shareOnboarding";
import { useAuth } from "./useAuth";

/** Kill switch on, iOS, 1.2.0+ binary. Fixed for the life of the JS bundle. */
export const SHARE_SETUP_SUPPORTED =
  SHARE_SETUP_ENABLED &&
  runtimeHasShareSetup(
    Platform.OS,
    Updates.runtimeVersion ?? Constants.expoConfig?.version ?? null,
  );

export function useShareAnnouncement() {
  const { token, status } = useAuth();
  const queryClient = useQueryClient();

  const flagsQuery = useQuery({
    queryKey: queryKeys.users.flags,
    queryFn: () => fetchUserFlags(token),
    enabled: SHARE_SETUP_SUPPORTED && status === "signed-in" && Boolean(token),
    staleTime: 5 * 60_000,
  });

  const dismissMutation = useMutation({
    mutationFn: () =>
      putUserFlag(token, USER_FLAG_KEYS.shareSheetAnnouncement, dismissedFlagValue(new Date())),
    // Optimistic: a failed write just brings the card back on the next fetch.
    onMutate: () => {
      queryClient.setQueryData<UserFlagsResponse>(queryKeys.users.flags, (prev) => ({
        flags: {
          ...(prev?.flags ?? {}),
          [USER_FLAG_KEYS.shareSheetAnnouncement]: dismissedFlagValue(new Date()),
        },
      }));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.users.flags }),
  });

  const dismiss = useCallback(() => dismissMutation.mutate(), [dismissMutation]);

  const visible = shouldShowShareAnnouncement({
    flags: flagsQuery.data?.flags,
    supported: SHARE_SETUP_SUPPORTED,
  });
  return { visible, dismiss };
}
