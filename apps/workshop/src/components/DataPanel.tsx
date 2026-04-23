import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { theme } from "./theme";

interface Props {
  visible: boolean;
  mode: "paste" | "importCsv" | "exportCsv";
  exportText?: string;
  loading?: boolean;
  onDismiss: () => void;
  onSubmit: (text: string) => void | Promise<void>;
}

export function DataPanel({ visible, mode, exportText, loading, onDismiss, onSubmit }: Props) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (visible) setValue("");
  }, [visible]);

  const title =
    mode === "paste" ? "Paste List" : mode === "importCsv" ? "Import from CSV" : "Export to CSV";

  const placeholder =
    mode === "paste"
      ? "The Shawshank Redemption\nInception\nParasite"
      : '"The Shawshank Redemption",3,false,movie\n"Breaking Bad",2,true,tv';

  const submitLabel = mode === "paste" ? "Add All" : "Replace All Data";
  const destructive = mode === "importCsv";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable style={styles.overlay} onPress={onDismiss} />
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>{title}</Text>
            <Pressable
              onPress={onDismiss}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              hitSlop={10}
            >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          {mode === "exportCsv" ? (
            <ScrollView style={styles.exportScroll}>
              <Text selectable style={styles.exportText}>
                {exportText || "No items to export."}
              </Text>
            </ScrollView>
          ) : (
            <>
              {destructive ? (
                <Text style={styles.warning}>⚠ This replaces all existing data.</Text>
              ) : null}
              <TextInput
                style={styles.input}
                value={value}
                onChangeText={setValue}
                placeholder={placeholder}
                placeholderTextColor={theme.textFaint}
                multiline
                autoCorrect={false}
                autoCapitalize="none"
              />
              <Pressable
                onPress={() => onSubmit(value)}
                disabled={!value.trim() || loading}
                style={({ pressed }) => [
                  styles.submit,
                  destructive && styles.submitDanger,
                  (!value.trim() || loading) && styles.submitDisabled,
                  pressed && styles.pressed,
                ]}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitText}>{submitLabel}</Text>
                )}
              </Pressable>
            </>
          )}
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
    paddingTop: 12,
    paddingBottom: 30,
    paddingHorizontal: 18,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: "88%",
    borderTopWidth: 1,
    borderColor: theme.border,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  title: { color: theme.text, fontSize: 18, fontWeight: "700" },
  close: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  closeText: { color: theme.textMuted, fontSize: 18 },
  pressed: { opacity: 0.7 },
  warning: {
    color: theme.red,
    backgroundColor: theme.redDim,
    padding: 10,
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 10,
  },
  input: {
    minHeight: 180,
    maxHeight: 340,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: theme.text,
    backgroundColor: theme.bg,
    textAlignVertical: "top",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  submit: {
    marginTop: 14,
    backgroundColor: theme.accent,
    padding: 15,
    borderRadius: 12,
    alignItems: "center",
  },
  submitDanger: { backgroundColor: theme.red },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  exportScroll: {
    maxHeight: 440,
    backgroundColor: theme.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 12,
  },
  exportText: {
    color: theme.text,
    fontSize: 13,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
});
