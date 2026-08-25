import { copyToClipboard } from "@workshop/ui/clipboard";
import { Platform, Share } from "react-native";

export { copyToClipboard };

export async function shareOrCopyLink(url: string): Promise<"shared" | "copied" | "failed"> {
  if (Platform.OS !== "web") {
    try {
      await Share.share({ message: url });
      return "shared";
    } catch {
      // Share sheet unavailable, fall through to a clipboard copy.
    }
  }
  return (await copyToClipboard(url)) ? "copied" : "failed";
}
