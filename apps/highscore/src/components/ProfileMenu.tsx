import { useQuery } from "@tanstack/react-query";
import { fetchFriendRequests } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import { Avatar, Button, Sheet, Text, tokens } from "@workshop/ui";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useAuth } from "../hooks/useAuth";

export function ProfileMenu() {
  const { token, user, signOut } = useAuth();
  const router = useRouter();
  const livePoll = useLivePollingInterval();
  const [open, setOpen] = useState(false);
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
        accessibilityLabel={pending > 0 ? `Profile, ${pending} friend requests` : "Profile"}
        onPress={() => setOpen(true)}
        testID="profile-menu-trigger"
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      >
        <Avatar
          name={user?.displayName ?? user?.email ?? null}
          imageUrl={user?.avatarUrl ?? null}
          size="md"
        />
        {pending > 0 ? (
          <View style={styles.badge}>
            <Text variant="caption" tone="onAccent" style={styles.badgeText}>
              {pending > 9 ? "9+" : pending}
            </Text>
          </View>
        ) : null}
      </Pressable>
      <Sheet visible={open} onRequestClose={() => setOpen(false)} testID="profile-menu-sheet">
        <View style={styles.content}>
          <View style={styles.identity}>
            <Avatar
              name={user?.displayName ?? user?.email ?? null}
              imageUrl={user?.avatarUrl ?? null}
              size="lg"
            />
            <View style={styles.identityText}>
              <Text variant="heading" numberOfLines={1}>
                {user?.displayName ?? "HighScore"}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {user?.email ?? ""}
              </Text>
            </View>
          </View>
          <Button
            label={pending > 0 ? `Friends (${pending})` : "Friends"}
            onPress={() => {
              setOpen(false);
              router.push("/friends");
            }}
          />
          <Button
            label="Sign out"
            variant="ghost"
            testID="sign-out"
            onPress={() => {
              setOpen(false);
              void signOut();
            }}
          />
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
  },
  pressed: { backgroundColor: tokens.bg.elevated },
  badge: {
    position: "absolute",
    right: 0,
    top: 0,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 3,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.accent.default,
    borderWidth: 2,
    borderColor: tokens.bg.canvas,
  },
  badgeText: { fontSize: 9, lineHeight: 11, fontWeight: tokens.font.weight.bold },
  content: { gap: tokens.space.md },
  identity: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  identityText: { flex: 1, minWidth: 0 },
});
