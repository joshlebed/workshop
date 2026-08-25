import { getShareExtensionKey } from "expo-share-intent";

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (path?.includes(`dataUrl=${getShareExtensionKey()}`)) return "/";
  return path;
}
