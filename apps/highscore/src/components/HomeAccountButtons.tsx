// The two account triggers in the home header. Friends gets its own icon
// (with the pending-request badge) and goes straight to /friends; the avatar
// goes straight to /profile — the "You" page — with no menu sheet between.
import { useQuery } from "@tanstack/react-query";
import { fetchFriendRequests } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useAuth } from "../hooks/useAuth";
import { Avatar, bodyType, PixelIcon, Text, tokens } from "../theme";

export function HomeAccountButtons() {
  const { token, user } = useAuth();
  const router = useRouter();
  const livePoll = useLivePollingInterval();
  const requestsQuery = useQuery({
    queryKey: queryKeys.friends.requests,
    queryFn: () => fetchFriendRequests(token),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  const pending = requestsQuery.data?.inbound.length ?? 0;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={pending > 0 ? `Friends, ${pending} requests` : "Friends"}
        onPress={() => router.push("/friends")}
        testID="home-friends"
        hitSlop={6}
        style={({ pressed, hovered }) => [styles.btn, (pressed || hovered) && styles.btnHover]}
      >
        <PixelIcon name="users" size={24} color={tokens.text.secondary} />
        {pending > 0 ? (
          <View style={styles.badge} testID="home-friends-badge">
            <Text style={styles.badgeText}>{pending > 9 ? "9+" : pending}</Text>
          </View>
        ) : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Your profile"
        onPress={() => router.push("/profile")}
        testID="profile-menu-trigger"
        hitSlop={6}
        style={({ pressed, hovered }) => [styles.btn, (pressed || hovered) && styles.btnHover]}
      >
        <Avatar
          name={user?.displayName ?? user?.email ?? null}
          imageUrl={user?.avatarUrl ?? null}
          size="md"
        />
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  btn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 0 },
  btnHover: { backgroundColor: tokens.bg.elevated },
  badge: {
    position: "absolute",
    right: 2,
    top: 2,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.neon.pink,
    borderWidth: 2,
    borderColor: tokens.bg.canvas,
  },
  badgeText: { ...bodyType("bold"), fontSize: 9, lineHeight: 11, color: tokens.text.onAccent },
});
