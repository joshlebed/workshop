import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from "react-native";
import { useAuth } from "../src/hooks/useAuth";

export default function SignIn() {
  const { requestCode, verifyCode } = useAuth();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRequest() {
    setError(null);
    setLoading(true);
    try {
      await requestCode(email.trim().toLowerCase());
      setStep("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : "something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function onVerify() {
    setError(null);
    setLoading(true);
    try {
      await verifyCode(email.trim().toLowerCase(), code.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text style={styles.title}>Workshop.dev</Text>
      <Text style={styles.subtitle}>
        {step === "email" ? "Sign in with your email" : `We sent a code to ${email}`}
      </Text>

      {step === "email" ? (
        <TextInput
          style={styles.input}
          placeholder="you@example.com"
          placeholderTextColor="#666"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          value={email}
          onChangeText={setEmail}
          editable={!loading}
        />
      ) : (
        <TextInput
          style={[styles.input, styles.code]}
          placeholder="123456"
          placeholderTextColor="#666"
          autoCapitalize="none"
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          maxLength={6}
          value={code}
          onChangeText={setCode}
          editable={!loading}
          autoFocus
        />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={({ pressed }) => [
          styles.button,
          (loading || (step === "email" ? !email : code.length !== 6)) && styles.buttonDisabled,
          pressed && styles.buttonPressed,
        ]}
        onPress={step === "email" ? onRequest : onVerify}
        disabled={loading || (step === "email" ? !email : code.length !== 6)}
      >
        {loading ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={styles.buttonText}>{step === "email" ? "Send code" : "Verify"}</Text>
        )}
      </Pressable>

      {step === "code" ? (
        <Pressable onPress={() => setStep("email")} disabled={loading}>
          <Text style={styles.link}>Use a different email</Text>
        </Pressable>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    backgroundColor: "#1a1a1a",
  },
  title: {
    fontSize: 40,
    fontWeight: "800",
    marginBottom: 8,
    color: "#fff",
  },
  subtitle: {
    fontSize: 16,
    color: "#aaa",
    marginBottom: 24,
  },
  input: {
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 10,
    padding: 14,
    fontSize: 18,
    backgroundColor: "#111",
    color: "#fff",
  },
  code: {
    fontSize: 28,
    letterSpacing: 6,
    textAlign: "center",
  },
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
  link: { marginTop: 16, textAlign: "center", color: "#aaa" },
  error: { color: "#f87171", marginTop: 12 },
});
