import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchFriendRequests } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import { Avatar, Button, Sheet, Text, tokens } from "@workshop/ui";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import { ImpersonationStatus } from "../admin/ImpersonationPanel";
import { useAuth } from "../hooks/useAuth";
import { PRIVACY_ROUTE, SUPPORT_ROUTE, TERMS_ROUTE } from "../lib/publicRoutes";

export function ProfileMenu() {
  const { token, user, signOut } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const livePoll = useLivePollingInterval();
  const [open, setOpen] = useState(false);
  const requestsQuery = useQuery({
    queryKey: queryKeys.friends.requests,
    queryFn: () => fetchFriendRequests(token),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  const pending = requestsQuery.data?.inbound.length ?? 0;

  const onSendFeedback = () => {
    const subject = encodeURIComponent("HighScore feedback");
    const version = Constants.expoConfig?.version ?? "0.0.0";
    const body = encodeURIComponent(
      `\n\nFeedback context\nHighScore v${version} · ${Platform.OS}${user?.id ? ` · ${user.id.slice(0, 8)}` : ""}`,
    );
    Linking.openURL(`mailto:joshlebed@gmail.com?subject=${subject}&body=${body}`).catch(() => {});
  };

  // Impersonation swaps the whole session — close the sheet and drop every
  // cached query so no other user's data leaks across accounts.
  const onAuthSessionChanged = useCallback(() => {
    setOpen(false);
    queryClient.clear();
  }, [queryClient]);

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
            label="Edit profile"
            variant="secondary"
            testID="open-edit-profile"
            onPress={() => {
              setOpen(false);
              router.push("/profile");
            }}
          />
          <Button
            label={pending > 0 ? `Friends (${pending})` : "Friends"}
            onPress={() => {
              setOpen(false);
              router.push("/friends");
            }}
          />
          <Button
            label="Send feedback"
            variant="secondary"
            testID="send-feedback"
            onPress={onSendFeedback}
          />
          {/* Both routes are public pages (see src/lib/publicRoutes.ts), so the
              in-app push lands on the same content Apple sees at the published
              highscore.live URLs — on native and web alike. */}
          <Button
            label="Support"
            variant="ghost"
            testID="open-support"
            onPress={() => {
              setOpen(false);
              router.push(SUPPORT_ROUTE);
            }}
          />
          <Button
            label="Privacy policy"
            variant="ghost"
            testID="open-privacy"
            onPress={() => {
              setOpen(false);
              router.push(PRIVACY_ROUTE);
            }}
          />
          <Button
            label="Terms of use"
            variant="ghost"
            testID="open-terms"
            onPress={() => {
              setOpen(false);
              router.push(TERMS_ROUTE);
            }}
          />
          {user?.isAdmin ? (
            <Button
              label="Admin dashboard"
              variant="secondary"
              testID="open-admin"
              onPress={() => {
                setOpen(false);
                router.push("/admin");
              }}
            />
          ) : null}
          <ImpersonationStatus onSessionChanged={onAuthSessionChanged} />
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
