import React, { useState } from "react";
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../AuthContext";
import { Button, Feather } from "../components/ui";
import { theme, type, radius, space, shadow } from "../theme";

export default function SignInScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async () => {
    setError(""); setBusy(true);
    try { await signIn(email, password); }
    catch (e) { setError(e?.message || "Could not sign in. Check your email and password."); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.wrap}>
          <View style={[styles.logo, shadow.brand]}>
            <Text style={styles.logoMark}>A</Text>
          </View>
          <Text style={type.display}>Welcome back</Text>
          <Text style={[type.body, { color: theme.ink3, marginTop: 4, marginBottom: space(7) }]}>
            Sign in with your Aster account
          </Text>

          <Text style={styles.fieldLabel}>Email</Text>
          <View style={styles.inputWrap}>
            <Feather name="mail" size={18} color={theme.ink4} />
            <TextInput
              style={styles.input}
              placeholder="you@company.com"
              placeholderTextColor={theme.ink4}
              autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
              textContentType="emailAddress" autoComplete="email"
              value={email} onChangeText={setEmail}
            />
          </View>

          <Text style={[styles.fieldLabel, { marginTop: space(4) }]}>Password</Text>
          <View style={styles.inputWrap}>
            <Feather name="lock" size={18} color={theme.ink4} />
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor={theme.ink4}
              secureTextEntry={!show} textContentType="password" autoComplete="password"
              value={password} onChangeText={setPassword} onSubmitEditing={onSubmit}
            />
            <Pressable onPress={() => setShow((s) => !s)} hitSlop={10}>
              <Feather name={show ? "eye-off" : "eye"} size={18} color={theme.ink4} />
            </Pressable>
          </View>

          {error ? (
            <View style={styles.errorRow}>
              <Feather name="alert-circle" size={15} color={theme.danger} />
              <Text style={[type.small, { color: theme.danger, marginLeft: 6, flex: 1 }]}>{error}</Text>
            </View>
          ) : null}

          <Button title="Sign in" icon="log-in" onPress={onSubmit} loading={busy} disabled={!email || !password} style={{ marginTop: space(6) }} />
          <Text style={[type.small, { color: theme.ink4, textAlign: "center", marginTop: space(5) }]}>
            Password reset and SSO are handled on hireaster.com
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", paddingHorizontal: space(7) },
  logo: { width: 58, height: 58, borderRadius: radius.lg, backgroundColor: theme.brand, alignItems: "center", justifyContent: "center", marginBottom: space(6) },
  logoMark: { color: theme.white, fontFamily: "Inter_700Bold", fontSize: 28 },
  fieldLabel: { ...type.smallStrong, color: theme.ink2, marginBottom: 8 },
  inputWrap: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, paddingHorizontal: 14, height: 52 },
  input: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 16, color: theme.ink },
  errorRow: { flexDirection: "row", alignItems: "center", backgroundColor: theme.dangerBg, borderRadius: radius.sm, padding: 12, marginTop: space(4) },
});
