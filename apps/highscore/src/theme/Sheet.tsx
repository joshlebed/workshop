// HighScore Sheet: the shared structural Sheet (modal/keyboard/animation
// machinery) re-skinned onto HighScore tokens — sharp corners, 2px bezel,
// purple surface. Every HighScore sheet should come through here.

import { Sheet as SharedSheet, type SheetProps } from "@workshop/ui";
import { StyleSheet } from "react-native";
import { bezel, colors } from "./tokens";

export type { SheetProps };

export function Sheet({ contentStyle, ...rest }: SheetProps) {
  return (
    <SharedSheet {...rest} contentStyle={StyleSheet.flatten([styles.content, contentStyle])} />
  );
}

const styles = StyleSheet.create({
  content: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderTopWidth: bezel,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderColor: colors.border,
  },
});
