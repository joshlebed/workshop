import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "../src/api/client";

export default function AddMovie() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setError(null);
    setLoading(true);
    try {
      await api.createItem({
        title: title.trim(),
        year: year ? Number(year) : null,
        notes: notes.trim() || null,
      });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to save");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View>
        <Text style={styles.label}>Title</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          autoFocus
          placeholder="The Shawshank Redemption"
          placeholderTextColor="#666"
        />

        <Text style={styles.label}>Year (optional)</Text>
        <TextInput
          style={styles.input}
          value={year}
          onChangeText={setYear}
          placeholder="1994"
          placeholderTextColor="#666"
          keyboardType="number-pad"
          maxLength={4}
        />

        <Text style={styles.label}>Notes (optional)</Text>
        <TextInput
          style={[styles.input, styles.notes]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Andy's prison-break drama"
          placeholderTextColor="#666"
          multiline
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={({ pressed }) => [
            styles.button,
            (!title.trim() || loading) && styles.buttonDisabled,
            pressed && styles.buttonPressed,
          ]}
          onPress={onSave}
          disabled={!title.trim() || loading}
        >
          {loading ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.buttonText}>Add</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#000" },
  label: { fontSize: 13, fontWeight: "600", color: "#aaa", marginBottom: 6, marginTop: 14 },
  input: {
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    backgroundColor: "#111",
    color: "#fff",
  },
  notes: { height: 100, textAlignVertical: "top" },
  button: {
    marginTop: 20,
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: "#000", fontSize: 16, fontWeight: "600" },
  error: { color: "#f87171", marginTop: 12 },
});
