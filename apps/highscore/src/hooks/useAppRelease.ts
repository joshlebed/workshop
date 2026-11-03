// The App Store update nudge, read on bootstrap. Values come from
// `GET /v1/client/release` and are set ONLY by the operator in the admin
// dashboard (docs/release-nudge-runbook.md). Web never nudges — there is no
// store binary to update — except the dev-only `?fakeInstalledVersion=` override.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import {
  type ClientReleasePlatform,
  HIGHSCORE_APP_STORE_URL,
  USER_FLAG_KEYS,
} from "@workshop/shared/constants";
import type { UserFlagsResponse } from "@workshop/shared/games";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { useCallback } from "react";
import { Linking, Platform } from "react-native";
import { fetchClientRelease, fetchUserFlags, putUserFlag } from "../api/release";
import {
  type AppReleaseNudge,
  dismissedFlagValue,
  fakeInstalledVersionFromSearch,
  isBannerDismissed,
  releaseNudgeFor,
} from "../lib/appRelease";
import { useAuth } from "./useAuth";

// Read once per page load so the override survives in-app navigation (which
// rewrites the URL). `__DEV__` keeps it out of every production bundle path.
const DEV_FAKE_INSTALLED_VERSION =
  __DEV__ && Platform.OS === "web" && typeof window !== "undefined"
    ? fakeInstalledVersionFromSearch(window.location.search)
    : null;

function installedBinaryVersion(): string | null {
  if (Platform.OS === "web") return DEV_FAKE_INSTALLED_VERSION;
  // `appVersion` runtime policy: the runtime version IS the binary's app.json
  // `version`. Dev clients / Expo Go have no runtime version → expoConfig.
  return Updates.runtimeVersion ?? Constants.expoConfig?.version ?? null;
}

const INSTALLED_VERSION = installedBinaryVersion();
// A faked web session reads the iOS row — that's the one being exercised.
const RELEASE_PLATFORM: ClientReleasePlatform | null =
  INSTALLED_VERSION === null ? null : Platform.OS === "android" ? "android" : "ios";

/** Open the store page; falls back to HighScore's App Store listing. */
export function openStoreUrl(storeUrl: string | null): void {
  Linking.openURL(storeUrl ?? HIGHSCORE_APP_STORE_URL).catch(() => {
    /* best-effort */
  });
}

/** Bootstrap read. Low refetch: the operator flips this a few times a year. */
export function useAppReleaseNudge(): AppReleaseNudge {
  const query = useQuery({
    queryKey: queryKeys.client.release("highscore", RELEASE_PLATFORM ?? "none"),
    queryFn: () => fetchClientRelease(RELEASE_PLATFORM ?? "ios"),
    enabled: RELEASE_PLATFORM !== null,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
  return releaseNudgeFor(INSTALLED_VERSION, query.data);
}

/**
 * The Games-home banner: the `available` nudge minus a per-(user, latestVersion)
 * dismissal stored in `user_flags` (never localStorage).
 */
export function useAppUpdateBanner() {
  const nudge = useAppReleaseNudge();
  const { token, status } = useAuth();
  const queryClient = useQueryClient();
  const candidate = nudge.kind === "available" ? nudge : null;

  const flagsQuery = useQuery({
    queryKey: queryKeys.users.flags,
    queryFn: () => fetchUserFlags(token),
    enabled: candidate !== null && status === "signed-in" && Boolean(token),
    staleTime: 5 * 60_000,
  });

  const dismissMutation = useMutation({
    mutationFn: (latestVersion: string) =>
      putUserFlag(token, USER_FLAG_KEYS.appUpdateDismissed, dismissedFlagValue(latestVersion)),
    onMutate: (latestVersion) => {
      queryClient.setQueryData<UserFlagsResponse>(queryKeys.users.flags, (prev) => ({
        flags: {
          ...(prev?.flags ?? {}),
          [USER_FLAG_KEYS.appUpdateDismissed]: dismissedFlagValue(latestVersion),
        },
      }));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.users.flags }),
  });

  const dismiss = useCallback(() => {
    if (candidate) dismissMutation.mutate(candidate.latestVersion);
  }, [candidate, dismissMutation]);

  // Hold the banner until flags load so a dismissed one doesn't flash.
  const visible =
    candidate !== null &&
    flagsQuery.isSuccess &&
    !isBannerDismissed(
      flagsQuery.data.flags[USER_FLAG_KEYS.appUpdateDismissed],
      candidate.latestVersion,
    );

  return { banner: visible ? candidate : null, dismiss };
}
