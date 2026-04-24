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
  return ls()?.getItem(key) ?? null;
}

export async function setItem(key: string, value: string): Promise<void> {
  ls()?.setItem(key, value);
}

export async function removeItem(key: string): Promise<void> {
  ls()?.removeItem(key);
}
