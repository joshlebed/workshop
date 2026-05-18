// Web implementation — Metro picks `.web.ts` over `.ts` on the web build.

function ls(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export async function getItem(key: string): Promise<string | null> {
  try {
    return ls()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    ls()?.setItem(key, value);
  } catch {
    // Browsers that block storage (Safari "Block All Cookies", some private
    // browsing modes) throw on write. Drop silently — callers treat
    // persistence as best-effort.
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    ls()?.removeItem(key);
  } catch {
    // See setItem above.
  }
}
