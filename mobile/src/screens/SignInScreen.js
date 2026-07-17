import React, { useState } from "react";
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../AuthContext";
import { Button } from "../components/ui";
import { theme, radius } from "../theme";

export default function SignInScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async () => {
    setError("");
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (e) {
      setError(e?.message || "Could not sign in. Check your email and password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.wrap}>
          <View style={styles.logoDot}>
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 22 }}>A</Text>
          </View>
          <Text style={styles.title}>Sign in to Aster</Text>
          <Text style={styles.sub}>Interview panel · use your Aster login</Text>

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={theme.ink3}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={theme.ink3}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={onSubmit}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button title={busy ? "Signing in…" : "Sign in"} onPress={onSubmit} disabled={busy || !email || !password} style={{ marginTop: 8 }} />
          <Text style={styles.note}>Password reset and SSO are handled on the web app at hireaster.com.</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", paddingHorizontal: 28 },
  logoDot: { width: 52, height: 52, borderRadius: 14, backgroundColor: theme.brand, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  title: { fontSize: 26, fontWeight: "800", color: theme.ink },
  sub: { color: theme.ink3, marginTop: 4, marginBottom: 24 },
  input: {
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 14,
    fontSize: 16,
    color: theme.ink,
    marginBottom: 12,
  },
  error: { color: theme.danger, marginBottom: 8 },
  note: { color: theme.ink3, fontSize: 12, textAlign: "center", marginTop: 16 },
});
