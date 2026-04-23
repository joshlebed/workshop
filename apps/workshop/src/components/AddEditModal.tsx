import type { RecCategory } from "@workshop/shared";
import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { categoryLabels, theme } from "./theme";

interface Props {
  visible: boolean;
  mode: "add" | "edit";
  category: RecCategory;
  initialTitle?: string;
  onDismiss: () => void;
  onSubmit: (title: string) => void | Promise<void>;
}

export function AddEditModal({
  visible,
  mode,
  category,
  initialTitle,
  onDismiss,
  onSubmit,
}: Props) {
  const [value, setValue] = useState("");
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setValue(initialTitle ?? "");
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [visible, initialTitle]);

  const placeholder =
    mode === "edit"
      ? `Edit ${categoryLabels[category].toLowerCase()} title`
      : `Enter a ${categoryLabels[category].toLowerCase()} title`;

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    void onSubmit(trimmed);
    setValue("");
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable style={styles.overlay} onPress={onDismiss} />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.heading}>
            {mode === "edit" ? "Edit" : "Add"} {categoryLabels[category].toLowerCase()}
          </Text>
          <View style={styles.row}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={value}
              onChangeText={setValue}
              placeholder={placeholder}
              placeholderTextColor={theme.textFaint}
              returnKeyType="done"
              onSubmitEditing={submit}
              autoCorrect={false}
              autoCapitalize="words"
            />
            <Pressable
              onPress={submit}
              disabled={!value.trim()}
              style={({ pressed }) => [
                styles.submit,
                !value.trim() && styles.submitDisabled,
                pressed && styles.pressed,
              ]}
              accessibilityLabel={mode === "edit" ? "Save" : "Add"}
            >
              <Text style={styles.submitText}>✓</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.overlay,
  },
  sheet: {
    backgroundColor: theme.bgElev,
    paddingTop: 10,
    paddingBottom: 30,
    paddingHorizontal: 18,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: theme.border,
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.border,
    marginBottom: 12,
  },
  heading: { color: theme.text, fontSize: 16, fontWeight: "700", marginBottom: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: theme.text,
    backgroundColor: theme.bg,
  },
  submit: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  submitDisabled: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
  submitText: { color: "#fff", fontSize: 22, fontWeight: "800" },
});
