import { getShareExtensionKey } from "expo-share-intent";

// The iOS share extension hands off through a sentinel deep link
// (`highscore://dataUrl=highscoreShareKey#text`), not a real route; the
// payload is read from the App Group by `useShareIntent` in `_layout.tsx`,
// which then navigates. On a cold start expo-router needs some route, so park
// it on `/`. With the app already running, return null so the router ignores
// the link entirely: navigating to `/` there races the share redirect and can
// land after it (the share-setup walkthrough's practice share ended up on the
// Games home instead of its "it works" screen).
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  if (path?.includes(`dataUrl=${getShareExtensionKey()}`)) return initial ? "/" : null;
  return path;
}
