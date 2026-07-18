import React, { useEffect, useState, useCallback } from "react";
import { View, Text, Switch, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { setStatusBarStyle } from "expo-status-bar";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { useAuth } from "../AuthContext";
import { Card, Avatar, Button, ScreenHeader, IconTile, Feather } from "../components/ui";
import { theme, type, space, radius } from "../theme";

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
        <Card style={{ flexDirection: "row", alignItems: "center" }}>
          <Avatar name={profile?.name || profile?.email} size={56} />
          <View style={{ marginLeft: 14, flex: 1 }}>
            <Text style={[type.h3, { color: theme.ink }]} numberOfLines={1}>{profile?.name || "Interviewer"}</Text>
            <Text style={[type.small, { color: theme.ink3 }]} numberOfLines={1}>{profile?.email}</Text>
            <View style={styles.roleTag}>
              <Feather name={manager ? "shield" : "user-check"} size={11} color={theme.brand} />
              <Text style={[type.smallStrong, { color: theme.brand, marginLeft: 5 }]}>{profile?.roleLabel}</Text>
            </View>
          </View>
        </Card>

        <Card style={{ marginTop: space(3), flexDirection: "row", alignItems: "center" }}>
          <IconTile name="shield" tint={theme.brand} />
          <View style={{ flex: 1, marginLeft: 12, paddingRight: 8 }}>
            <Text style={[type.bodyStrong, { color: theme.ink }]}>Biometric unlock</Text>
            <Text style={[type.small, { color: theme.ink3, marginTop: 2 }]}>
              {bioAvailable ? "Require Face ID / fingerprint on open" : "No biometrics enrolled on this device"}
            </Text>
          </View>
          <Switch value={bioOn} onValueChange={toggleBio} disabled={!bioAvailable} trackColor={{ true: theme.brand }} />
        </Card>

        <Card style={{ marginTop: space(3), flexDirection: "row", alignItems: "center" }}>
          <IconTile name="bell" tint="#7C3AED" />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[type.bodyStrong, { color: theme.ink }]}>Notifications</Text>
            <Text style={[type.small, { color: theme.ink3, marginTop: 2 }]}>Push on for interviews, panels and reminders. Detailed prefs on web.</Text>
          </View>
        </Card>

        <Card style={{ marginTop: space(3), flexDirection: "row", alignItems: "center" }}>
          <IconTile name="home" tint={theme.success} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[type.bodyStrong, { color: theme.ink }]}>{profile?.company}</Text>
            <Text style={[type.small, { color: theme.ink3, marginTop: 2 }]}>{manager ? "Full pipeline access" : "Interview panel access"}</Text>
          </View>
        </Card>

        <Button title="Sign out" icon="log-out" variant="ghost" onPress={signOut} style={{ marginTop: space(6) }} />
        <Text style={[type.small, { color: theme.ink4, textAlign: "center", marginTop: space(4) }]}>Aster · v0.1.0</Text>
      </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  roleTag: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", backgroundColor: theme.brandSoft, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, marginTop: 6 },
});
