import React, { useEffect, useState, useCallback } from "react";
import { View, Text, Switch, ScrollView, Pressable, StyleSheet, Modal, TextInput, ActivityIndicator, Keyboard } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "@react-navigation/native";
import { setStatusBarStyle } from "expo-status-bar";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { useAuth } from "../AuthContext";
import { registerForPush, unregisterPush, PUSH_PREF_KEY } from "../lib/push";
import { getMyOfferSignature, saveMyOfferSignature } from "../lib/data";
import { Avatar, Press, Feather } from "../components/ui";
import { AsterMark } from "../components/Logo";
import { theme, type, space, radius, shadow } from "../theme";

const BIOMETRIC_PREF_KEY = "aster.biometric.enabled";

export default function ProfileScreen({ navigation }) {
  const { profile, manager, signOut, setBiometricEnabled } = useAuth();
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioOn, setBioOn] = useState(false);
  const [pushOn, setPushOn] = useState(true);
  // Offer signature (0135): the sender's sign-off, stamped on composed offers.
  const [sigOpen, setSigOpen] = useState(false);
  const [savedSig, setSavedSig] = useState(null); // current stored value

  useEffect(() => { if (manager) getMyOfferSignature().then(setSavedSig).catch(() => {}); }, [manager]);
  const sigSummary = savedSig ? (savedSig.startsWith("typed:") ? savedSig.slice(6) : "Drawn signature (set on web)") : "Not set";

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
          {/* Workspace */}
          <Text style={styles.sectionLabel}>WORKSPACE</Text>
          <View style={styles.group}>
            <Row
              icon="home" tint={theme.success}
              title={profile?.company || "Your workspace"}
              last={!manager}
            />
            {manager ? (
              <Row
                icon="edit-3" tint="#7C3AED"
                title="Offer signature"
                  subtitle={sigSummary}
                right={<Feather name="chevron-right" size={18} color={theme.ink4} />}
                onPress={() => setSigOpen(true)}
                last
              />
            ) : null}
          </View>

          {/* Preferences */}
          <Text style={styles.sectionLabel}>PREFERENCES</Text>
          <View style={styles.group}>
            <Row
              icon="shield" tint={theme.brand}
              title="Biometric unlock"
              subtitle={bioAvailable ? undefined : "No biometrics enrolled on this device"}
              right={<Switch value={bioOn} onValueChange={toggleBio} disabled={!bioAvailable} trackColor={{ true: theme.brand, false: theme.line }} thumbColor="#fff" />}
            />
            <Row
              icon="bell" tint="#7C3AED"
              title="Notifications"
              right={<Switch value={pushOn} onValueChange={togglePush} trackColor={{ true: theme.brand, false: theme.line }} thumbColor="#fff" />}
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

      <OfferSignatureSheet
        visible={sigOpen}
        initial={savedSig}
        name={profile?.name}
        onClose={() => setSigOpen(false)}
        onSaved={(v) => setSavedSig(v)}
      />
    </View>
  );
}

function Row({ icon, tint, title, subtitle, right, last, onPress }) {
  const body = (
    <>
      <View style={[styles.rowIcon, { backgroundColor: tint + "18" }]}>
        <Feather name={icon} size={17} color={tint} />
      </View>
      <View style={{ flex: 1, marginLeft: 12, paddingRight: 8 }}>
        <Text style={[type.bodyStrong, { color: theme.ink }]}>{title}</Text>
        {subtitle ? <Text style={[type.small, { color: theme.ink3, marginTop: 2, lineHeight: 18 }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.row, !last && styles.rowDivider, pressed && { backgroundColor: theme.bg }]}>
        {body}
      </Pressable>
    );
  }
  return <View style={[styles.row, !last && styles.rowDivider]}>{body}</View>;
}

// Typed offer-signature capture. Mobile renders the sign-off in a script font on
// the letter/PDF (same as web's "type" option); drawing lives on the web app.
function OfferSignatureSheet({ visible, initial, name, onClose, onSaved }) {
  const insets = useSafeAreaInsets();
  const isTyped = !initial || initial.startsWith("typed:");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!visible) return;
    setErr(null);
    setText(initial && initial.startsWith("typed:") ? initial.slice(6) : (isTyped ? (name || "") : ""));
  }, [visible]);

  const save = async () => {
    Keyboard.dismiss();
    const val = text.trim() ? `typed:${text.trim()}` : null;
    setBusy(true); setErr(null);
    const e = await saveMyOfferSignature(val);
    setBusy(false);
    if (e) { setErr(e); return; }
    onSaved?.(val);
    onClose();
  };
  const clear = async () => {
    setBusy(true); setErr(null);
    const e = await saveMyOfferSignature(null);
    setBusy(false);
    if (e) { setErr(e); return; }
    setText(""); onSaved?.(null); onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.sheetBackdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(3) }]}>
          <View style={styles.sheetHandle} />
          <Text style={[type.h3, { color: theme.ink }]}>Offer signature</Text>
          <Text style={[type.small, { color: theme.ink3, marginTop: 4, lineHeight: 19 }]}>
            Type your name to sign off the offers you compose. It's placed above your name in the letter; the candidate then counter-signs. Prefer to draw it? Use the Aster web app.
          </Text>

          {!isTyped ? (
            <View style={styles.drawnNote}>
              <Feather name="edit-2" size={13} color={theme.ink3} />
              <Text style={[type.small, { color: theme.ink3, marginLeft: 8, flex: 1 }]}>A drawn signature is saved from the web app. Typing below replaces it.</Text>
            </View>
          ) : null}

          <Text style={[type.smallStrong, { color: theme.ink2, marginTop: space(4), marginBottom: 7 }]}>Your name</Text>
          <TextInput value={text} onChangeText={(v) => { setText(v); setErr(null); }} placeholder="e.g. Jane Tan" placeholderTextColor={theme.ink4} style={styles.sigInput} autoFocus />
          {text.trim() ? (
            <View style={styles.sigPreview}>
              <Text style={styles.sigPreviewTxt}>{text.trim()}</Text>
            </View>
          ) : null}

          {err ? <Text style={[type.small, { color: theme.danger, marginTop: 10 }]}>{err}</Text> : null}

          <View style={{ flexDirection: "row", gap: 10, marginTop: space(5) }}>
            {initial ? (
              <Pressable onPress={clear} disabled={busy} style={[styles.sigBtn, { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line }]}>
                <Text style={[type.smallStrong, { color: theme.ink2 }]}>Clear</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={save} disabled={busy || !text.trim()} style={[styles.sigBtn, { backgroundColor: text.trim() ? theme.brand : theme.line, flex: 1 }]}>
              {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={[type.smallStrong, { color: "#fff" }]}>Save signature</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { paddingBottom: space(6), overflow: "hidden" },
  watermark: { position: "absolute", top: 4, right: -28 },
  headerTop: { flexDirection: "row", alignItems: "center", paddingHorizontal: space(4), paddingTop: space(2) },
  circleBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 20, letterSpacing: -0.4, color: theme.white, marginLeft: 14 },
  profileRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: space(5), marginTop: space(5) },
  avatarRing: { padding: 3, borderRadius: 36, borderWidth: 2, borderColor: "rgba(255,255,255,0.5)", backgroundColor: "rgba(255,255,255,0.12)" },
  profileName: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 20, letterSpacing: -0.4, color: theme.white },
  profileEmail: { fontFamily: "Inter_500Medium", fontSize: 13, color: "rgba(255,255,255,0.8)", marginTop: 2 },
  roleTag: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.18)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, marginTop: 8 },

  sectionLabel: { ...type.label, color: theme.ink4, marginTop: space(5), marginBottom: space(2), marginLeft: space(1) },
  group: { backgroundColor: theme.card, borderRadius: radius.card, overflow: "hidden", ...shadow.sm },
  row: { flexDirection: "row", alignItems: "center", padding: space(4) },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: theme.line2 },
  rowIcon: { width: 38, height: 38, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },

  signOut: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: space(7), paddingVertical: space(4), borderRadius: radius.md, backgroundColor: "#FEF3F2", borderWidth: 1, borderColor: "#FECDCA" },
  version: { ...type.small, color: theme.ink4, textAlign: "center", marginTop: space(5) },

  sheetBackdrop: { flex: 1, backgroundColor: "rgba(10,14,40,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: space(5), paddingTop: space(3) },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.line, marginBottom: space(4) },
  drawnNote: { flexDirection: "row", alignItems: "center", marginTop: space(3), padding: space(3), borderRadius: radius.md, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line },
  sigInput: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11, fontFamily: "Inter_500Medium", fontSize: 15, color: theme.ink },
  sigPreview: { marginTop: 10, borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 14, minHeight: 60, justifyContent: "center" },
  sigPreviewTxt: { fontSize: 28, color: theme.ink, fontStyle: "italic", fontFamily: "Inter_500Medium" },
  sigBtn: { alignItems: "center", justifyContent: "center", borderRadius: radius.md, paddingVertical: 13, paddingHorizontal: 20 },
});
