import { getShareExtensionKey } from "expo-share-intent";

// iOS Share Extension hand-off uses a sentinel deep link
// (`workshop:///dataUrl=workshopShareKey`), not a real route. Without this
// hook expo-router tries to match the path against the file system and lands
// on its "Unmatched Route" screen before `useShareIntent` in `_layout.tsx`
// can pull the payload out of App Group UserDefaults and redirect to
// `/share`. Returning `/` parks expo-router on home; the hook still receives
// the URL via `useLinkingURL` and drives the real navigation.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (path?.includes(`dataUrl=${getShareExtensionKey()}`)) {
    return "/";
  }
  return path;
}
