import React, { useEffect, useState, useCallback } from "react";
import { View, Text, Switch, ScrollView, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "@react-navigation/native";
import { setStatusBarStyle } from "expo-status-bar";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { useAuth } from "../AuthContext";
import { registerForPush, unregisterPush, PUSH_PREF_KEY } from "../lib/push";
import { Avatar, Press, Feather } from "../components/ui";
import { AsterMark } from "../components/Logo";
import { theme, type, space, radius, shadow } from "../theme";

const BIOMETRIC_PREF_KEY = "aster.biometric.enabled";

export default function ProfileScreen({ navigation }) {
  const { profile, manager, signOut, setBiometricEnabled } = useAuth();
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioOn, setBioOn] = useState(false);
  const [pushOn, setPushOn] = useState(true);

  useEffect(() => {
    (async () => {
      const hw = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setBioAvailable(hw && enrolled);
      setBioOn((await SecureStore.getItemAsync(BIOMETRIC_PREF_KEY)) === "1");
      setPushOn((await SecureStore.getItemAsync(PUSH_PREF_KEY)) !== "0"); // default on
    })();
  }, []);

  const toggleBio = async (v) => { setBioOn(v); await setBiometricEnabled(v); };

  // Register/unregister this device for push and remember the choice.
  const togglePush = async (v) => {
    setPushOn(v);
    try { await SecureStore.setItemAsync(PUSH_PREF_KEY, v ? "1" : "0"); } catch { /* best-effort */ }
    if (v) registerForPush(profile?.userId).catch(() => {});
    else unregisterPush().catch(() => {});
  };

  useFocusEffect(useCallback(() => { setStatusBarStyle("light"); }, []));

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Gradient header with the profile folded in */}
      <LinearGradient colors={["#123AF0", "#0B2AE0", "#0A1E9E"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.header}>
        <View style={styles.watermark} pointerEvents="none"><AsterMark size={150} color="rgba(255,255,255,0.10)" /></View>
        <SafeAreaView edges={["top"]}>
          <View style={styles.headerTop}>
            {navigation?.canGoBack?.() ? (
              <Press onPress={() => navigation.goBack()} haptic="light" style={styles.circleBtn}>
                <Feather name="arrow-left" size={20} color={theme.white} />
              </Press>
            ) : <View style={{ width: 40 }} />}
            <Text style={styles.headerTitle}>Settings</Text>
          </View>

          <View style={styles.profileRow}>
            <View style={styles.avatarRing}>
              <Avatar name={profile?.name || profile?.email} size={58} />
            </View>
            <View style={{ marginLeft: 14, flex: 1 }}>
              <Text style={styles.profileName} numberOfLines={1}>{profile?.name || "Interviewer"}</Text>
              <Text style={styles.profileEmail} numberOfLines={1}>{profile?.email}</Text>
              <View style={styles.roleTag}>
                <Feather name={manager ? "shield" : "user-check"} size={11} color={theme.white} />
                <Text style={[type.smallStrong, { color: theme.white, marginLeft: 5 }]}>{profile?.roleLabel}</Text>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <SafeAreaView style={{ flex: 1 }} edges={["bottom"]}>
        <ScrollView contentContainerStyle={{ padding: space(4), paddingBottom: space(10) }} showsVerticalScrollIndicator={false}>
          {/* Preferences */}
          <Text style={styles.sectionLabel}>PREFERENCES</Text>
          <View style={styles.group}>
            <Row
              icon="shield" tint={theme.brand}
              title="Biometric unlock"
              subtitle={bioAvailable ? "Require Face ID / fingerprint on open" : "No biometrics enrolled on this device"}
              right={<Switch value={bioOn} onValueChange={toggleBio} disabled={!bioAvailable} trackColor={{ true: theme.brand, false: theme.line }} thumbColor="#fff" />}
            />
            <Row
              icon="bell" tint="#7C3AED"
              title="Notifications"
              subtitle={pushOn ? "Push for interviews, panels and reminders on this device." : "Push is off on this device. You'll still see the bell."}
              right={<Switch value={pushOn} onValueChange={togglePush} trackColor={{ true: theme.brand, false: theme.line }} thumbColor="#fff" />}
              last
            />
          </View>

          {/* Workspace */}
          <Text style={styles.sectionLabel}>WORKSPACE</Text>
          <View style={styles.group}>
            <Row
              icon="home" tint={theme.success}
              title={profile?.company || "Your workspace"}
              subtitle={manager ? "Full pipeline access" : "Interview panel access"}
              last
            />
          </View>

          {/* Sign out (destructive) */}
          <Pressable onPress={signOut} style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.85 }]}>
            <Feather name="log-out" size={18} color={theme.danger} />
            <Text style={[type.bodyStrong, { color: theme.danger, marginLeft: 10 }]}>Sign out</Text>
          </Pressable>

          <Text style={styles.version}>Aster · v0.1.0</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Row({ icon, tint, title, subtitle, right, last }) {
  return (
    <View style={[styles.row, !last && styles.rowDivider]}>
      <View style={[styles.rowIcon, { backgroundColor: tint + "18" }]}>
        <Feather name={icon} size={17} color={tint} />
      </View>
      <View style={{ flex: 1, marginLeft: 12, paddingRight: 8 }}>
        <Text style={[type.bodyStrong, { color: theme.ink }]}>{title}</Text>
        {subtitle ? <Text style={[type.small, { color: theme.ink3, marginTop: 2, lineHeight: 18 }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingBottom: space(6), overflow: "hidden" },
  watermark: { position: "absolute", top: 4, right: -28 },
  headerTop: { flexDirection: "row", alignItems: "center", paddingHorizontal: space(4), paddingTop: space(2) },
  circleBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 20, letterSpacing: -0.3, color: theme.white, marginLeft: 14 },
  profileRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: space(5), marginTop: space(5) },
  avatarRing: { padding: 3, borderRadius: 36, borderWidth: 2, borderColor: "rgba(255,255,255,0.5)", backgroundColor: "rgba(255,255,255,0.12)" },
  profileName: { fontFamily: "Inter_700Bold", fontSize: 20, letterSpacing: -0.3, color: theme.white },
  profileEmail: { fontFamily: "Inter_500Medium", fontSize: 13, color: "rgba(255,255,255,0.8)", marginTop: 2 },
  roleTag: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.18)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, marginTop: 8 },

  sectionLabel: { ...type.label, color: theme.ink4, marginTop: space(5), marginBottom: space(2), marginLeft: space(1) },
  group: { backgroundColor: theme.card, borderRadius: radius.card, overflow: "hidden", ...shadow.sm },
  row: { flexDirection: "row", alignItems: "center", padding: space(4) },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: theme.line2 },
  rowIcon: { width: 38, height: 38, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },

  signOut: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: space(7), paddingVertical: space(4), borderRadius: radius.md, backgroundColor: "#FEF3F2", borderWidth: 1, borderColor: "#FECDCA" },
  version: { ...type.small, color: theme.ink4, textAlign: "center", marginTop: space(5) },
});
