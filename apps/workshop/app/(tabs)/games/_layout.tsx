import { tokens } from "@workshop/ui";
import { Stack } from "expo-router";

// The Games tab's stack (G1b): home (leaderboard cards) + per-game board.
// Mirrors the (lists) group's navigator options — static `tokens` for the
// scene background, matching the root layout (see apps/workshop/CLAUDE.md).
export default function GamesLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: tokens.bg.canvas },
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" options={{ animation: "slide_from_right" }} />
    </Stack>
  );
}
