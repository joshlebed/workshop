import { useToast } from "@workshop/ui";
import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardShortcutsSheet } from "../../components/KeyboardShortcutsSheet";
import { useAuth } from "../../hooks/useAuth";
import { useShortcuts } from "./useShortcuts";

/**
 * Shortcuts that work on every signed-in screen (web): `?` opens the
 * shortcuts sheet, ⌘/ opens Activity, ⌘Z runs the showing toast's Undo. Screen shortcuts (`/`, `N`) live with
 * their screens. Mounted once in the root layout.
 */
export function GlobalShortcuts() {
  const { status } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { runLatestAction } = useToast();
  const signedIn = status === "signed-in";
  useShortcuts(
    {
      help: () => setOpen(true),
      activity: () => router.push("/activity"),
      // ⌘Z runs the Undo of the newest toast that offers one (5.5): the
      // toast's own button sits at the end of the tab order.
      undo: () => {
        runLatestAction("Undo");
      },
    },
    signedIn,
  );
  if (!signedIn) return null;
  return <KeyboardShortcutsSheet visible={open} onClose={() => setOpen(false)} />;
}
