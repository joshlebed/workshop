import { StyleSheet, View } from "react-native";
import { tokens } from "./tokens";

/**
 * Placeholder rows while a sheet's content loads. A centred spinner in an
 * otherwise empty sheet is 700px of dead space; a few bars at least keep the
 * layout where it will be when the data lands.
 */
export function Skeleton({ lines = 4 }: { lines?: number }) {
  return (
    <View style={styles.root} accessibilityRole="progressbar" accessibilityLabel="Loading">
      {Array.from({ length: lines }, (_, index) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder
          key={index}
          style={[styles.bar, { width: `${88 - index * 11}%` }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: tokens.space.sm, paddingTop: tokens.space.sm },
  bar: { height: 14, backgroundColor: tokens.bg.raised },
});
