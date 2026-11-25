// Accept / decline an inbound directed friend request, shared by the Friends
// inbox (FriendsHome) and the home card (FriendRequestCard) so both toast,
// invalidate and track per-row in-flight state the same way.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { acceptFriendRequestFrom, removeFriendRequest } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { haptics } from "@workshop/ui";
import { useState } from "react";
import { useToast } from "../../theme";
import { useGamesRuntime } from "../runtime";

export function useFriendRequestAnswers() {
  const { token } = useGamesRuntime();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [answeringIds, setAnsweringIds] = useState<string[]>([]);
  const settle = (userId: string) => setAnsweringIds((ids) => ids.filter((id) => id !== userId));

  const acceptMutation = useMutation({
    mutationFn: (userId: string) => {
      setAnsweringIds((ids) => [...ids, userId]);
      return acceptFriendRequestFrom(userId, token);
    },
    onSuccess: async (data) => {
      haptics.medium();
      showToast({
        message: `You're now friends with ${data.friend.displayName?.trim() || "them"}!`,
        tone: "success",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.friends.all }),
        queryClient.invalidateQueries({ queryKey: ["games"] }),
      ]);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't accept that request."), tone: "danger" });
    },
    onSettled: (_data, _err, userId) => settle(userId),
  });

  const declineMutation = useMutation({
    mutationFn: (userId: string) => {
      setAnsweringIds((ids) => [...ids, userId]);
      return removeFriendRequest(userId, token);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.friends.all });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't decline that request."), tone: "danger" });
    },
    onSettled: (_data, _err, userId) => settle(userId),
  });

  return {
    accept: acceptMutation.mutate,
    decline: declineMutation.mutate,
    answeringIds,
  };
}
