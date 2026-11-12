import { Avatar, interaction, tokens } from "@workshop/ui";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useAuth } from "../hooks/useAuth";

/** Home header avatar: opens Settings (3.5). 44pt target around a 36pt disc. */
export function HomeAvatarButton() {
  const { user } = useAuth();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Settings"
      onPress={() => router.push("/settings")}
      testID="open-settings"
      style={styles.target}
    >
      {({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => (
        <View style={[styles.ring, (pressed || hovered) && styles.ringActive]}>
          <Avatar
            name={user?.displayName ?? user?.email ?? null}
            imageUrl={user?.avatarUrl}
            size="md"
            style={styles.avatar}
          />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    width: tokens.hit,
    height: tokens.hit,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.pill,
  },
  ring: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: tokens.bg.surface,
  },
  ringActive: { opacity: 0.85, backgroundColor: interaction.pressed },
  avatar: { width: 36, height: 36, borderRadius: 18 },
});
