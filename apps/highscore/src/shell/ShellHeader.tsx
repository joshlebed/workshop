// The ledger's only permanent chrome. Left: the sign. Right: two doors —
// the friend faces open the drawer, your own face opens the profile sheet.
// No tab bar, no title, no back control: nothing above this ever pushes.

import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import type { FriendSummary } from "@workshop/shared/friends";
import { Pressable, StyleSheet, View } from "react-native";
import { Wordmark } from "../components/Wordmark";
import { Avatar, PixelIcon, pixelType, tokens } from "../theme";
import { Text } from "../theme/Text";

export interface ShellHeaderProps {
  friends: FriendSummary[];
  pendingRequests: number;
  myName: string | null;
  myAvatarUrl: string | null;
  onOpenFriends: () => void;
  onOpenProfile: () => void;
}

const FACES = 3;

export function ShellHeader({
  friends,
  pendingRequests,
  myName,
  myAvatarUrl,
  onOpenFriends,
  onOpenProfile,
}: ShellHeaderProps) {
  const faces = friends.slice(0, FACES);
  return (
    <View style={styles.header}>
      <Wordmark />
      <View style={styles.right}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            pendingRequests > 0 ? `Friends, ${pendingRequests} requests` : "Friends"
          }
          onPress={onOpenFriends}
          hitSlop={8}
          testID="open-friends"
          style={({ pressed }) => [styles.friends, pressed && styles.dim]}
        >
          {faces.length === 0 ? (
            <PixelIcon name="users" size={24} color={tokens.text.secondary} />
          ) : (
            faces.map((friend, i) => (
              <View key={friend.userId} style={i > 0 ? styles.faceOverlap : undefined}>
                <Avatar
                  name={friend.displayName}
                  imageUrl={userAvatarImageUrl(friend.userId)}
                  size="sm"
                />
              </View>
            ))
          )}
          {pendingRequests > 0 ? (
            <Text style={styles.pending} testID="friends-pending-count">
              {pendingRequests > 9 ? "9+" : pendingRequests}
            </Text>
          ) : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Your profile"
          onPress={onOpenProfile}
          hitSlop={8}
          testID="profile-menu-trigger"
          style={({ pressed }) => [styles.me, pressed && styles.dim]}
        >
          <Avatar name={myName} imageUrl={myAvatarUrl} size="md" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.md,
    gap: tokens.space.md,
  },
  right: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  friends: { flexDirection: "row", alignItems: "center" },
  faceOverlap: { marginLeft: -7 },
  pending: { ...pixelType(10), color: tokens.neon.pink, marginLeft: tokens.space.sm },
  me: {},
  dim: { opacity: 0.6 },
});
