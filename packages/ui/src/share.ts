import { Platform, Share } from "react-native";
import { copyToClipboard } from "./clipboard";

/** Open the native share sheet, falling back to a clipboard copy. */
export async function shareOrCopyLink(url: string): Promise<"shared" | "copied" | "failed"> {
  if (Platform.OS !== "web") {
    try {
      await Share.share({ message: url });
      return "shared";
    } catch {
      // Share sheet unavailable — fall through to a clipboard copy.
    }
  }
  return (await copyToClipboard(url)) ? "copied" : "failed";
}
