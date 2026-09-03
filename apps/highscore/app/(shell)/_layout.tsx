// The persistent shell.
//
// A layout in expo-router is not remounted when you move between its child
// routes, so `/`, `/games/:id`, `/friends` and `/friends/:userId` all resolve
// to this one mounted `<Shell />`. Each child route renders `null`; the shell
// reads the pathname and animates. That is what makes "expand in place" and
// the slide-over drawer possible without giving up real URLs, deep links,
// browser/system back, or refresh.

import { Slot } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Shell } from "../../src/shell/Shell";

export default function ShellLayout() {
  return (
    <View style={styles.root}>
      <Shell />
      {/* The child routes draw nothing — they exist so the URL stays honest.
          Kept out of the layout flow and out of the touch tree. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Slot />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
