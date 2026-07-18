import React, { useEffect, useState, useCallback } from "react";
import { View, Text, Switch, ScrollView, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { setStatusBarStyle } from "expo-status-bar";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { useAuth } from "../AuthContext";
import { Avatar, ScreenHeader, Feather } from "../components/ui";
import { theme, type, space, radius, shadow } from "../theme";

const BIOMETRIC_PREF_KEY = "aster.biometric.enabled";

export default function ProfileScreen({ navigation }) {
  const { profile, manager, signOut, setBiometricEnabled } = useAuth();
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioOn, setBioOn] = useState(false);

  useEffect(() => {
    (async () => {
      const hw = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setBioAvailable(hw && enrolled);
      setBioOn((await SecureStore.getItemAsync(BIOMETRIC_PREF_KEY)) === "1");
    })();
  }, []);

  const toggleBio = async (v) => { setBioOn(v); await setBiometricEnabled(v); };

  useFocusEffect(useCallback(() => { setStatusBarStyle("light"); }, []));

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader eyebrow="Account" title="Settings" onBack={navigation?.canGoBack?.() ? () => navigation.goBack() : undefined} />
      <SafeAreaView style={{ flex: 1 }} edges={["bottom"]}>
        <ScrollView contentContainerStyle={{ padding: space(4), paddingBottom: space(10) }} showsVerticalScrollIndicator={false}>
          {/* Profile hero */}
          <View style={styles.hero}>
            <Avatar name={profile?.name || profile?.email} size={62} />
            <View style={{ marginLeft: 14, flex: 1 }}>
              <Text style={[type.h3, { color: theme.ink }]} numberOfLines={1}>{profile?.name || "Interviewer"}</Text>
              <Text style={[type.small, { color: theme.ink3, marginTop: 1 }]} numberOfLines={1}>{profile?.email}</Text>
              <View style={styles.roleTag}>
                <Feather name={manager ? "shield" : "user-check"} size={11} color={theme.brand} />
                <Text style={[type.smallStrong, { color: theme.brand, marginLeft: 5 }]}>{profile?.roleLabel}</Text>
              </View>
            </View>
          </View>

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
              subtitle="Push for interviews, panels and reminders. Detailed prefs on web."
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
  hero: { flexDirection: "row", alignItems: "center", backgroundColor: theme.card, borderRadius: radius.card, padding: space(4), ...shadow.sm },
  roleTag: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", backgroundColor: theme.brandSoft, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, marginTop: 7 },

  sectionLabel: { ...type.label, color: theme.ink4, marginTop: space(6), marginBottom: space(2), marginLeft: space(1) },
  group: { backgroundColor: theme.card, borderRadius: radius.card, overflow: "hidden", ...shadow.sm },
  row: { flexDirection: "row", alignItems: "center", padding: space(4) },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: theme.line2 },
  rowIcon: { width: 38, height: 38, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },

  signOut: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: space(7), paddingVertical: space(4), borderRadius: radius.md, backgroundColor: "#FEF3F2", borderWidth: 1, borderColor: "#FECDCA" },
  version: { ...type.small, color: theme.ink4, textAlign: "center", marginTop: space(5) },
});
