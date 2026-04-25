import { Pressable, Modal as RNModal, StyleSheet, type ViewStyle } from "react-native";
import { tokens } from "./theme";

export interface ModalProps {
  visible: boolean;
  onRequestClose: () => void;
  children: React.ReactNode;
  /**
   * Centered card on web/desktop, full-bleed on small screens. Sheet behavior
   * (slide-up from bottom) lives in `Sheet.tsx`.
   */
  contentStyle?: ViewStyle;
  testID?: string;
}

export function Modal({ visible, onRequestClose, children, contentStyle, testID }: ModalProps) {
  return (
    <RNModal
      visible={visible}
      onRequestClose={onRequestClose}
      transparent
      animationType="fade"
      testID={testID}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close modal"
        style={styles.backdrop}
        onPress={onRequestClose}
      >
        <Pressable
          accessibilityRole="none"
          onPress={(e) => e.stopPropagation()}
          style={[styles.card, contentStyle]}
        >
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
    alignItems: "center",
    justifyContent: "center",
    padding: tokens.space.lg,
  },
  card: {
    backgroundColor: tokens.bg.surface,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    padding: tokens.space.xl,
    maxWidth: 480,
    width: "100%",
  },
});
