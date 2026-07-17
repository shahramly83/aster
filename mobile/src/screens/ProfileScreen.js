import React, { useEffect, useState } from "react";
import { View, Text, Switch, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { useAuth } from "../AuthContext";
import { Card, Avatar, Button, ScreenTitle } from "../components/ui";
import { theme } from "../theme";

const BIOMETRIC_PREF_KEY = "aster.biometric.enabled";

export default function ProfileScreen() {
  const { profile, signOut, setBiometricEnabled } = useAuth();
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioOn, setBioOn] = useState(false);

  useEffect(() => {
    (async () => {
      const hw = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setBioAvailable(hw && enrolled);
      const pref = await SecureStore.getItemAsync(BIOMETRIC_PREF_KEY);
      setBioOn(pref === "1");
    })();
  }, []);

  const toggleBio = async (v) => {
    setBioOn(v);
    await setBiometricEnabled(v);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={["top"]}>
      <ScreenTitle>Me</ScreenTitle>
      <View style={{ padding: 16 }}>
        <Card style={{ flexDirection: "row", alignItems: "center" }}>
          <Avatar name={profile?.name || profile?.email} size={52} />
          <View style={{ marginLeft: 14, flex: 1 }}>
            <Text style={styles.name}>{profile?.name || "Interviewer"}</Text>
            <Text style={styles.meta}>{profile?.email}</Text>
            <Text style={styles.badge}>{profile?.roleLabel} · {profile?.company}</Text>
          </View>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.settingLabel}>Unlock with Face ID / fingerprint</Text>
              <Text style={styles.settingHint}>
                {bioAvailable ? "Require biometrics each time you open Aster." : "No biometrics enrolled on this device."}
              </Text>
            </View>
            <Switch value={bioOn} onValueChange={toggleBio} disabled={!bioAvailable} trackColor={{ true: theme.brand }} />
          </View>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <Text style={styles.settingLabel}>Notifications</Text>
          <Text style={styles.settingHint}>
            Push is on for new interviews, panel invites and reminders. Manage detailed preferences on the web app.
          </Text>
        </Card>

        <Button title="Sign out" variant="ghost" onPress={signOut} style={{ marginTop: 20 }} />
        <Text style={styles.version}>Aster for interviewers · v0.1.0</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 18, fontWeight: "800", color: theme.ink },
  meta: { color: theme.ink2, marginTop: 1 },
  badge: { color: theme.brand, marginTop: 4, fontSize: 12, fontWeight: "700" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  settingLabel: { fontSize: 15, fontWeight: "700", color: theme.ink },
  settingHint: { color: theme.ink3, marginTop: 3, lineHeight: 18 },
  version: { color: theme.ink3, textAlign: "center", marginTop: 24, fontSize: 12 },
});
