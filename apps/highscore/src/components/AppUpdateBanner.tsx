// "A new version of HighScore is on the App Store" — the dismissible
// Games-home banner for the operator-set `latestVersion` nudge.

import { StyleSheet, View } from "react-native";
import { openStoreUrl, useAppUpdateBanner } from "../hooks/useAppRelease";
import { Button, IconButton, PixelIcon, Text, tokens } from "../theme";

export function AppUpdateBanner() {
  const { banner, dismiss } = useAppUpdateBanner();
  if (!banner) return null;
  return (
    <View style={styles.banner} testID="app-update-banner" accessibilityRole="summary">
      <View style={styles.copy}>
        <Text variant="label">A new version of HighScore is on the App Store</Text>
        {banner.message ? (
          <Text variant="caption" tone="secondary">
            {banner.message}
          </Text>
        ) : null}
      </View>
      <Button
        label="Update"
        onPress={() => openStoreUrl(banner.storeUrl)}
        testID="app-update-banner-update"
      />
      <IconButton
        accessibilityLabel="Dismiss update banner"
        onPress={dismiss}
        testID="app-update-banner-dismiss"
      >
        <PixelIcon name="close" size={16} color={tokens.text.secondary} />
      </IconButton>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    marginHorizontal: tokens.space.lg,
    marginBottom: tokens.space.sm,
    padding: tokens.space.md,
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.yellow,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.surface,
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
});
