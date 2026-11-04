import { useState } from "react";
import { canAutoOpenApp } from "../lib/inAppBrowser";

// Also survives route remounts when the WebView disables sessionStorage.
const continuedPaths = new Set<string>();

/** Keep an explicit web choice through sign-in redirects in this browser tab. */
export function useInAppBrowserPrompt(path: string | null) {
  const [continuedPath, setContinuedPath] = useState<string | null>(null);
  const supportsApp = canAutoOpenApp();
  const key = `highscore:continue-on-web:${path}`;
  let remembered = !!path && continuedPaths.has(path);
  if (path && supportsApp) {
    try {
      remembered ||= sessionStorage.getItem(key) === "1";
    } catch {
      // Some embedded browsers disable storage; use the in-memory choice.
    }
  }
  const showAppPrompt = !!path && supportsApp && continuedPath !== path && !remembered;
  const continueOnWeb = () => {
    if (path) continuedPaths.add(path);
    try {
      sessionStorage.setItem(key, "1");
    } catch {
      // The in-memory choice still lets the user proceed.
    }
    setContinuedPath(path);
  };
  return { showAppPrompt, continueOnWeb };
}
