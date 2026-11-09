// The share-sheet onboarding on Games home — the walkthrough that opens itself
// once after sign-in (`autoOpen` + `markOnboarded`) and the announcement card
// that stays until dealt with (`visible` + `dismiss`) — plus whether this
// binary gets the share-setup surfaces at all (rules: src/lib/shareOnboarding.ts).
// Every marker is a `user_flags` row, never localStorage, so a reinstall or a
// second device doesn't re-run it.

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
  onboardedFlagValue,
  runtimeHasShareSetup,
  SHARE_SETUP_ENABLED,
  shouldAutoOpenShareSetup,
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
  const { token, status, impersonation } = useAuth();
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

  const onboardedMutation = useMutation({
    mutationFn: () =>
      putUserFlag(
        token,
        USER_FLAG_KEYS.shareSheetAnnouncement,
        onboardedFlagValue(
          queryClient.getQueryData<UserFlagsResponse>(queryKeys.users.flags)?.flags[
            USER_FLAG_KEYS.shareSheetAnnouncement
          ],
          new Date(),
        ),
      ),
    // Optimistic so the auto-open can't fire twice; a failed write only
    // means the walkthrough opens itself once more on a later launch.
    onMutate: () => {
      queryClient.setQueryData<UserFlagsResponse>(queryKeys.users.flags, (prev) => ({
        flags: {
          ...(prev?.flags ?? {}),
          [USER_FLAG_KEYS.shareSheetAnnouncement]: onboardedFlagValue(
            prev?.flags[USER_FLAG_KEYS.shareSheetAnnouncement],
            new Date(),
          ),
        },
      }));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.users.flags }),
  });
  const markOnboarded = useCallback(() => onboardedMutation.mutate(), [onboardedMutation]);

  const flags = flagsQuery.data?.flags;
  const visible = shouldShowShareAnnouncement({ flags, supported: SHARE_SETUP_SUPPORTED });
  // An admin impersonating someone must never be walked through their onboarding.
  const autoOpen =
    impersonation === null && shouldAutoOpenShareSetup({ flags, supported: SHARE_SETUP_SUPPORTED });
  return { visible, dismiss, autoOpen, markOnboarded };
}
