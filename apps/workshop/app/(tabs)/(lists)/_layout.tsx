import { Stack } from "expo-router";
import { tokens } from "../../../src/ui/index";

// Anchor the stack on home. When a route deep in this stack is reached without
// an in-app history beneath it — a cold deep link, a Universal Link, or the
// share-intent flow's cross-navigator `router.replace` (which rebuilds this
// stack fresh with only the target screen) — expo-router otherwise leaves the
// target as the sole entry. `canGoBack()` is then false, so the screens' back
// buttons fall through `goBack()` to `router.replace(parent)`, which animates
// as a forward push (`animationTypeForReplace` defaults to "push") — the back
// button visibly slides the wrong way. Declaring `index` as the anchor puts
// home beneath the target so `router.back()` (a real pop) handles it instead.
export const unstable_settings = {
  initialRouteName: "index",
};

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
      <Stack.Screen name="profile" options={{ presentation: "modal" }} />
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
