import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import { GamesHome as SharedGamesHome } from "@workshop/games/screens/GamesHome";
import { InlineTabSwitch } from "@workshop/ui";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";
import { Platform } from "react-native";
import { fetchActivity } from "../api/activity";
import { fetchLists } from "../api/lists";
import { HeaderActivityButton } from "../components/HeaderActivityButton";
import { ProfileMenu } from "../components/ProfileMenu";
import { useAuth } from "../hooks/useAuth";

export function GamesHome() {
  const { token } = useAuth();
  const router = useRouter();
  const livePoll = useLivePollingInterval();

  const listsQuery = useQuery({
    queryKey: queryKeys.lists.all,
    queryFn: () => fetchLists(token),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  const allLists = listsQuery.data?.lists ?? [];
  const archivedLists = useMemo(() => allLists.filter((list) => !!list.archivedAt), [allLists]);
  const totalUnread = useMemo(
    () => allLists.reduce((total, list) => total + (list.mutedAt ? 0 : list.unreadCount), 0),
    [allLists],
  );

  const activityFeedQuery = useQuery({
    queryKey: queryKeys.activity.feed,
    queryFn: () => fetchActivity({ limit: 50 }, token),
    enabled: Platform.OS === "web" && !!token,
    staleTime: 30_000,
    refetchInterval: livePoll,
  });

  const onActivity = useCallback(() => router.push("/activity?from=games"), [router]);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault();
        onActivity();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onActivity]);

  return (
    <SharedGamesHome
      headerLeft={<InlineTabSwitch />}
      headerTrailing={
        <>
          {Platform.OS === "web" ? (
            <HeaderActivityButton
              unreadCount={totalUnread}
              error={activityFeedQuery.isError}
              onPress={onActivity}
              onRetry={() => void activityFeedQuery.refetch()}
              testID="open-activity"
            />
          ) : null}
          <ProfileMenu archivedLists={archivedLists} />
        </>
      }
    />
  );
}
