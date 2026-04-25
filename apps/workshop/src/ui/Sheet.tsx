import { Pressable, Modal as RNModal, StyleSheet, View, type ViewStyle } from "react-native";
import { tokens } from "./theme";

export interface SheetProps {
  visible: boolean;
  onRequestClose: () => void;
  children: React.ReactNode;
  contentStyle?: ViewStyle;
  testID?: string;
}

/**
 * Bottom sheet — slides up on iOS via RN Modal's `slide` animation. On web,
 * RN Modal renders inline so the slide degrades to a static bottom panel.
 * Real spring/drag behavior lands with the haptics + reanimated work in 1b-2.
 */
export function Sheet({ visible, onRequestClose, children, contentStyle, testID }: SheetProps) {
  return (
    <RNModal
      visible={visible}
      onRequestClose={onRequestClose}
      transparent
      animationType="slide"
      testID={testID}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close sheet"
        style={styles.backdrop}
        onPress={onRequestClose}
      >
        <Pressable
          accessibilityRole="none"
          onPress={(e) => e.stopPropagation()}
          style={[styles.sheet, contentStyle]}
        >
          <View style={styles.handle} />
          {children}
        </Pressable>
      </Pressable>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: tokens.bg.surface,
    borderTopLeftRadius: tokens.radius.lg,
    borderTopRightRadius: tokens.radius.lg,
    borderColor: tokens.border.subtle,
    borderTopWidth: 1,
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.lg,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: tokens.border.strong,
  },
});
