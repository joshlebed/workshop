import { Stack } from "expo-router";
import { tokens } from "../../../src/ui/index";

// The pre-Games app stack, unchanged — it moved here from the root layout
// when the Lists/Games tab shell landed (G0). Group segments don't appear in
// URLs, so `/`, `/list/:id/...`, `/activity`, and `/create-list/...` resolve
// exactly as before.
export default function ListsLayout() {
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
      <Stack.Screen name="create-list/type" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="create-list/customize" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="create-list/playlist" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="activity" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="list/[id]/index" />
      <Stack.Screen name="list/[id]/add" options={{ presentation: "modal" }} />
      <Stack.Screen name="list/[id]/add-bulk" options={{ presentation: "modal" }} />
      <Stack.Screen name="list/[id]/settings" options={{ presentation: "modal" }} />
      <Stack.Screen name="list/[id]/item/[itemId]" />
    </Stack>
  );
}
