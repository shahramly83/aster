// Biometric lock screen. Auto-prompts Face/fingerprint on mount; the button
// re-triggers if the user dismissed it. Full Aster-blue field with a pulsing
// biometric ring so it reads as a deliberate, secure gate (not a dead end).
import React, { useEffect, useRef } from "react";
import { View, Text, Pressable, StyleSheet, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { useAuth } from "../AuthContext";
import { AsterMark, AsterLogo } from "./Logo";
import { Feather } from "./ui";
import { theme } from "../theme";

export default function LockScreen() {
  const { unlock } = useAuth();
  useEffect(() => { unlock(); }, [unlock]);

  // Two staggered expanding rings for a soft "listening for biometrics" pulse.
  const p1 = useRef(new Animated.Value(0)).current;
  const p2 = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const mk = (v, delay) => Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration: 2000, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    const a = mk(p1, 0), b = mk(p2, 1000);
    a.start(); b.start();
    return () => { a.stop(); b.stop(); };
  }, [p1, p2]);
  const ring = (v) => ({ transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 2.1] }) }], opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0] }) });

  return (
    <View style={{ flex: 1, backgroundColor: theme.brand }}>
      <StatusBar style="light" />
      <LinearGradient colors={["#1A48FF", "#0B2AE0", "#081C93"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={styles.watermark} pointerEvents="none"><AsterMark size={230} color="rgba(255,255,255,0.07)" /></View>

      <SafeAreaView style={styles.center}>
        <View style={styles.bioWrap}>
          <Animated.View style={[styles.pulseRing, ring(p1)]} />
          <Animated.View style={[styles.pulseRing, ring(p2)]} />
          <View style={styles.bioCircle}><Feather name="lock" size={36} color="#fff" /></View>
        </View>

        <AsterLogo width={168} color="#fff" />
        <Text style={styles.subtitle}>Verify it's you to continue.</Text>

        <Pressable onPress={unlock} style={({ pressed }) => [styles.btn, pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] }]}>
          <Feather name="unlock" size={18} color={theme.brand} />
          <Text style={styles.btnTxt}>Unlock</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  watermark: { position: "absolute", top: -34, right: -46 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  bioWrap: { width: 150, height: 150, alignItems: "center", justifyContent: "center", marginBottom: 44 },
  pulseRing: { position: "absolute", width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: "rgba(255,255,255,0.5)" },
  bioCircle: { width: 96, height: 96, borderRadius: 48, backgroundColor: "rgba(255,255,255,0.14)", borderWidth: 1, borderColor: "rgba(255,255,255,0.28)", alignItems: "center", justifyContent: "center" },
  subtitle: { fontFamily: "Inter_500Medium", fontSize: 15, color: "rgba(255,255,255,0.82)", textAlign: "center", marginTop: 16 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, backgroundColor: "#fff", borderRadius: 16, height: 54, paddingHorizontal: 40, marginTop: 44, minWidth: 200, shadowColor: "#0A1E9E", shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  btnTxt: { fontFamily: "Inter_700Bold", fontSize: 16, color: theme.brand },
});
