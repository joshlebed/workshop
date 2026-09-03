// The feed group: one persistent timeline, one sheet host, and a slot.
//
// Every route in this group renders `null`; the timeline below is mounted once
// and never unmounts, so opening a game board or a profile does not tear the
// day feed down and rebuild it — it slides a sheet over the top while the URL
// changes underneath. `SheetHost` reads the URL and decides which sheet (and
// how deep a stack) that is.
//
// The one exception is `/friends/accept/:token`, which is a full screen: it can
// be reached signed-out and it is a one-time decision, not a place. It renders
// into the slot overlay above everything else.

import { Slot } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useAuth } from "../../src/hooks/useAuth";
import { SheetHost } from "../../src/nav/SheetHost";
import { tokens } from "../../src/theme";
import { TimelineHome } from "../../src/timeline/TimelineHome";

export default function FeedLayout() {
  const { status } = useAuth();
  return (
    <View style={styles.root}>
      {status === "signed-in" ? <TimelineHome /> : null}
      <SheetHost />
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Slot />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
});
