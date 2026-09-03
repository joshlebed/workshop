import { Image, StyleSheet, View } from "react-native";
import { PixelIcon, tokens } from "../../theme";

interface GameCoverProps {
  iconUrl: string | null;
  size: number;
  /** Off-day / unplayed rows render the cover at half strength. */
  dim?: boolean;
}

/** A game's square mark. Favicons fall back to the pixel gamepad. No bezel:
 * see the note on Avatar — outlines mean state here, not identity. */
export function GameCover({ iconUrl, size, dim = false }: GameCoverProps) {
  const box = { width: size, height: size };
  return (
    <View style={[styles.frame, box, dim && styles.dim]}>
      {iconUrl ? (
        <Image
          resizeMode="contain"
          source={{ uri: iconUrl }}
          style={box}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <PixelIcon name="gamepad" size={size >= 40 ? 24 : 16} color={tokens.text.secondary} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.elevated,
    overflow: "hidden",
  },
  dim: { opacity: 0.45 },
});
