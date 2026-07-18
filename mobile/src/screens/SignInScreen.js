import React, { useState } from "react";
import { View, Text, TextInput, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { useAuth } from "../AuthContext";
import { Button, Feather } from "../components/ui";
import { AsterLogo, AsterMark } from "../components/Logo";
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
    <View style={{ flex: 1, backgroundColor: theme.brand }}>
      <StatusBar style="light" />
      <LinearGradient colors={["#123AF0", "#0B2AE0", "#0A1E9E"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={styles.watermark} pointerEvents="none"><AsterMark size={220} color="rgba(255,255,255,0.08)" /></View>

      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Brand */}
            <View style={{ alignItems: "center", marginBottom: space(6) }}>
              <AsterLogo width={190} color={theme.white} />
            </View>
            <Text style={styles.welcome}>Welcome back</Text>
            <Text style={styles.subtitle}>Sign in to your Aster workspace</Text>

            {/* Card */}
            <View style={styles.card}>
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

              <Button title="Sign in" icon="log-in" onPress={onSubmit} loading={busy} disabled={!email || !password} style={{ marginTop: space(5) }} />
            </View>

            <Text style={styles.footer}>Password reset and SSO are handled on hireaster.com</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  watermark: { position: "absolute", top: -30, right: -50 },
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: space(6), paddingVertical: space(10) },
  welcome: { fontFamily: "Inter_700Bold", fontSize: 30, letterSpacing: -0.6, color: theme.white, textAlign: "center" },
  subtitle: { fontFamily: "Inter_500Medium", fontSize: 15, color: "rgba(255,255,255,0.8)", textAlign: "center", marginTop: 6 },
  card: { backgroundColor: theme.card, borderRadius: 24, padding: space(5), marginTop: space(7), shadowColor: "#0A1E9E", shadowOpacity: 0.28, shadowRadius: 30, shadowOffset: { width: 0, height: 16 }, elevation: 10 },
  fieldLabel: { ...type.smallStrong, color: theme.ink2, marginBottom: 8 },
  inputWrap: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, paddingHorizontal: 14, height: 52 },
  input: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 16, color: theme.ink },
  errorRow: { flexDirection: "row", alignItems: "center", backgroundColor: theme.dangerBg, borderRadius: radius.sm, padding: 12, marginTop: space(4) },
  footer: { fontFamily: "Inter_400Regular", fontSize: 12.5, color: "rgba(255,255,255,0.7)", textAlign: "center", marginTop: space(6) },
});
