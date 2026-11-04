// Browser-only behavior, imported by OpenInAppCard's .web implementation.
// Embedded browsers may reject a scripted scheme navigation. Always keep the
// real anchor available: an explicit tap gets a separate chance to open the app.
export function scheduleAppOpen(url: string): () => void {
  const timer = setTimeout(() => {
    if (document.visibilityState === "hidden") return;
    try {
      window.location.assign(url);
    } catch {
      // A blocked scheme must leave the retry and web continuation usable.
    }
  }, 0);
  return () => clearTimeout(timer);
}

/** Continue on web only if a manual open never leaves the foreground. */
export function watchAppOpen(onFallback: () => void): () => void {
  const startedAt = Date.now();
  const fallbackMs = 2000;
  const timer = setTimeout(() => {
    cleanup();
    // A suspended WebView can resume its timers much later. Don't redirect the
    // returning user, even if that browser omitted the lifecycle events.
    if (document.visibilityState !== "hidden" && Date.now() - startedAt < fallbackMs + 750) {
      onFallback();
    }
  }, fallbackMs);

  function onVisibilityChange() {
    if (document.visibilityState === "hidden") cleanup();
  }
  function cleanup() {
    clearTimeout(timer);
    window.removeEventListener("pagehide", cleanup);
    window.removeEventListener("blur", cleanup);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }
  window.addEventListener("pagehide", cleanup);
  window.addEventListener("blur", cleanup);
  document.addEventListener("visibilitychange", onVisibilityChange);
  return cleanup;
}
