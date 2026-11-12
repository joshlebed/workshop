import { tokens } from "@workshop/ui";
import { Stack } from "expo-router";
import { TwoPaneShell } from "../../../src/screens/twoPane/TwoPane";

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
// URLs, so `/`, `/list/:id/...`, and `/create-list/...` resolve exactly as before.
// On desktop web the stack renders in the right pane of `TwoPaneShell`, with
// the lists in a sidebar beside it (5.7c); on phones and native the shell is
// a pass-through.
export default function ListsLayout() {
  return (
    <TwoPaneShell>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: tokens.bg.canvas },
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
        }}
      >
        {/* 3.8: destinations push (settings, profile, list settings, item);
          flows that create something are modals (add, add-bulk). */}
        <Stack.Screen name="index" />
        <Stack.Screen name="settings/index" />
        <Stack.Screen name="settings/hidden" />
        <Stack.Screen name="settings/delete-account" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="create-list/type" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="create-list/customize" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="create-list/playlist" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="list/[id]/index" />
        <Stack.Screen name="list/[id]/add" options={{ presentation: "modal" }} />
        <Stack.Screen name="list/[id]/add-bulk" options={{ presentation: "modal" }} />
        <Stack.Screen name="list/[id]/settings" />
        <Stack.Screen name="list/[id]/item/[itemId]" />
      </Stack>
    </TwoPaneShell>
  );
}
