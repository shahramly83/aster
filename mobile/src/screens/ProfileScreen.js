import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, Switch, ScrollView, Pressable, StyleSheet, Modal, ActivityIndicator, Keyboard, TextInput, Platform, useWindowDimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "@react-navigation/native";
import { setStatusBarStyle } from "expo-status-bar";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { useAuth } from "../AuthContext";
import { registerForPush, unregisterPush, PUSH_PREF_KEY } from "../lib/push";
import { getMyOfferSignature, saveMyOfferSignature, getMyOfferSignatory, saveMyOfferSignatory, getOfferLetterTemplate, saveOfferLetterTemplate } from "../lib/data";
import { OFFER_LETTER_DEFAULT, OFFER_TOKENS, toggleBoldRange } from "../lib/offerLetter";
import { Avatar, Press, Feather } from "../components/ui";
import { AsterMark } from "../components/Logo";
import { theme, type, space, radius, shadow } from "../theme";
import SignaturePad from "../components/SignaturePad";

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
  // A typed signature can still exist on older accounts (and the web app can
  // still save one), so keep reading it; new ones from here are always drawn.
  const [tplOpen, setTplOpen] = useState(false);
  const [tplCustom, setTplCustom] = useState(false);
  useEffect(() => { getOfferLetterTemplate().then((t) => setTplCustom(!!t)); }, []);
  const sigSummary = savedSig ? (savedSig.startsWith("typed:") ? `Typed · ${savedSig.slice(6)}` : "Signed") : "Not set";

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
                icon="file-text" tint="#0EA5E9"
                title="Offer letter"
                subtitle={tplCustom ? "Your company's wording" : "Aster's default wording"}
                right={<Feather name="chevron-right" size={18} color={theme.ink4} />}
                onPress={() => setTplOpen(true)}
              />
            ) : null}
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

      <OfferLetterSheet
        visible={tplOpen}
        onClose={() => setTplOpen(false)}
        onSaved={(v) => setTplCustom(!!v)}
      />
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

// Same hook the offer sheet uses: iOS does not resize the window for the
// keyboard, so a bottom sheet has to be lifted by hand.
function useKeyboardHeight() {
  const [h, setH] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const sh = Keyboard.addListener(showEvt, (e) => setH(e.endCoordinates?.height || 0));
    const hd = Keyboard.addListener(hideEvt, () => setH(0));
    return () => { sh.remove(); hd.remove(); };
  }, []);
  return h;
}

// The company's offer letter, written once and reused by every offer. Tokens
// stay literal here: this is the wording for future offers, and there is no one
// candidate to fill them from. Owner/admin only, enforced by the RPC.
function OfferLetterSheet({ visible, onClose, onSaved }) {
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  const { height: winH } = useWindowDimensions();
  const [text, setText] = useState("");
  const [base, setBase] = useState(undefined);
  const [sel, setSel] = useState({ start: 0, end: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setErr(null);
    getOfferLetterTemplate().then((t) => {
      if (!alive) return;
      setBase(t || null); setText(t || OFFER_LETTER_DEFAULT);
    });
    return () => { alive = false; };
  }, [visible]);

  const bold = () => {
    const r = toggleBoldRange(text, sel.start, sel.end);
    if (!r) return;
    setText(r.text);
    setTimeout(() => ref.current?.setNativeProps?.({ selection: { start: r.start, end: r.end } }), 0);
  };
  const insert = (tok) => {
    const a2 = sel.start, b2 = sel.end;
    setText(text.slice(0, a2) + tok + text.slice(b2));
    setTimeout(() => ref.current?.setNativeProps?.({ selection: { start: a2 + tok.length, end: a2 + tok.length } }), 0);
  };
  const save = async () => {
    Keyboard.dismiss();
    setBusy(true); setErr(null);
    // Saving Aster's default verbatim means "no custom wording": stored as null
    // so the company keeps following the default if it ever changes.
    const val = text.trim() === OFFER_LETTER_DEFAULT.trim() ? null : (text.trim() || null);
    const e = await saveOfferLetterTemplate(val);
    setBusy(false);
    if (e) { setErr(e); return; }
    onSaved?.(val);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.sheetBackdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        {/* The editor is the only part that gives way to the keyboard. Left to
            grow, it pushed the title, the token buttons and Save off the top of
            the screen, so there was no way to save without dismissing the
            keyboard first. */}
        <View style={[styles.sheet, {
          paddingBottom: insets.bottom + space(3),
          maxHeight: winH * 0.9,
          marginBottom: Platform.OS === "ios" && kb > 0 ? kb : 0,
        }]}>
          <View style={styles.sheetHandle} />
          <Text style={[type.h3, { color: theme.ink }]}>Offer letter</Text>
          <Text style={[type.small, { color: theme.ink3, marginTop: 4, lineHeight: 18 }]}>
            Every offer starts from this. Aster fills the role, salary and dates.
          </Text>

          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", marginTop: space(4) }}>
            <Pressable onPress={bold} style={({ pressed }) => [styles.tplBold, pressed && { backgroundColor: theme.bg }]}>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: theme.ink2 }}>B</Text>
            </Pressable>
            {OFFER_TOKENS.map((t) => (
              <Pressable key={t} onPress={() => insert(t)} style={({ pressed }) => [styles.tplTok, pressed && { opacity: 0.7 }]}>
                <Text style={{ fontSize: 11, color: theme.brand, fontFamily: "Inter_600SemiBold" }}>{t}</Text>
              </Pressable>
            ))}
          </View>

          <TextInput
            ref={ref}
            value={text}
            onChangeText={setText}
            onSelectionChange={(e) => setSel(e.nativeEvent.selection)}
            multiline
            editable={base !== undefined && !busy}
            style={[styles.sigInput, {
              marginTop: space(3),
              height: kb > 0 ? Math.max(120, winH * 0.28) : Math.max(200, winH * 0.42),
              textAlignVertical: "top",
              lineHeight: 20,
            }]}
          />
          <Text style={[type.small, { color: theme.ink3, marginTop: 6, fontSize: 11.5 }]}>
            Wrap text in **double asterisks** to bold it in the sent letter.
          </Text>

          {err ? <Text style={[type.small, { color: theme.danger, marginTop: 10 }]}>{err}</Text> : null}

          <View style={{ flexDirection: "row", gap: 10, marginTop: space(5) }}>
            <Pressable onPress={() => setText(OFFER_LETTER_DEFAULT)} disabled={busy} style={[styles.sigBtn, { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line }]}>
              <Text style={[type.smallStrong, { color: theme.ink2 }]}>Reset</Text>
            </Pressable>
            <Pressable onPress={save} disabled={busy || base === undefined} style={[styles.sigBtn, { backgroundColor: theme.brand, flex: 1 }]}>
              {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={[type.smallStrong, { color: "#fff" }]}>Save offer letter</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Offer-signature capture. Drawn only, on both platforms.
function OfferSignatureSheet({ visible, initial, name, onClose, onSaved }) {
  const insets = useSafeAreaInsets();
  // Drawn only. Typing your name was never a signature, just your name in a
  // script face, and it made the mobile signature a different artefact from the
  // one the web app produces. The pad renders a real PNG (SignaturePad), which is
  // what the offer PDF embeds.
  // The pad hands back a LAZY encoder, so the PNG is only rasterised when you
  // actually save. It has to live in a ref: passing a function to a setState
  // setter makes React treat it as an updater and call it immediately, storing
  // the string it returns, so `toPng()` then threw "not a function" on save.
  const toPngRef = useRef(null);
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // Name and title, same as the web Settings card. A signature on its own is a
  // mark; these are what make it a sign-off block on the letter.
  const [sigName, setSigName] = useState("");
  const [sigTitle, setSigTitle] = useState("");

  useEffect(() => {
    if (!visible) return;
    setErr(null); toPngRef.current = null; setHasInk(false);
    let alive = true;
    getMyOfferSignatory().then(({ name, title }) => {
      if (!alive) return;
      setSigName(name || ""); setSigTitle(title || "");
    });
    return () => { alive = false; };
  }, [visible]);

  const save = async () => {
    Keyboard.dismiss();
    // A fresh drawing replaces the old one; with no new ink the existing
    // signature is kept, so this also saves a name or title on its own.
    let val = initial || null;
    if (toPngRef.current) {
      try {
        val = toPngRef.current();
      } catch (e2) {
        setErr("Couldn't save that signature. Try drawing it again."); return;
      }
    }
    if (!val) return;
    setBusy(true); setErr(null);
    const e = await saveMyOfferSignatory(val, sigName.trim() || null, sigTitle.trim() || null);
    setBusy(false);
    if (e) { setErr(e); return; }
    onSaved?.(val);
    onClose();
  };
  const clear = async () => {
    setBusy(true); setErr(null);
    const e = await saveMyOfferSignatory(null, sigName.trim() || null, sigTitle.trim() || null);
    setBusy(false);
    if (e) { setErr(e); return; }
    toPngRef.current = null; setHasInk(false); onSaved?.(null); onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.sheetBackdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(3) }]}>
          <View style={styles.sheetHandle} />
          <Text style={[type.h3, { color: theme.ink }]}>Offer signature</Text>
          <View style={{ marginTop: space(4) }}>
            <SignaturePad onChange={(fn) => { toPngRef.current = fn; setHasInk(!!fn); }} />
          </View>

          <Text style={styles.sigLabel}>Full name</Text>
          <TextInput
            value={sigName}
            onChangeText={setSigName}
            placeholder="Name as it should appear on the letter"
            placeholderTextColor={theme.ink4}
            style={styles.sigInput}
          />
          <Text style={styles.sigLabel}>Job title</Text>
          <TextInput
            value={sigTitle}
            onChangeText={setSigTitle}
            placeholder="e.g. Talent Acquisition Lead"
            placeholderTextColor={theme.ink4}
            style={styles.sigInput}
          />
          <Text style={[type.small, { color: theme.ink3, marginTop: 6, fontSize: 11.5 }]}>
            Used on offer letters only, so they can differ from your account name.
          </Text>

          {err ? <Text style={[type.small, { color: theme.danger, marginTop: 10 }]}>{err}</Text> : null}

          <View style={{ flexDirection: "row", gap: 10, marginTop: space(5) }}>
            {initial ? (
              <Pressable onPress={clear} disabled={busy} style={[styles.sigBtn, { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line }]}>
                <Text style={[type.smallStrong, { color: theme.ink2 }]}>Clear</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={save} disabled={busy || !(hasInk || initial)} style={[styles.sigBtn, { backgroundColor: (hasInk || initial) ? theme.brand : theme.line, flex: 1 }]}>
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
  tplBold: { width: 32, height: 32, borderRadius: radius.sm, borderWidth: 1, borderColor: theme.line, alignItems: "center", justifyContent: "center", marginRight: 8, marginBottom: 8 },
  tplTok: { borderRadius: radius.sm, borderWidth: 1, borderColor: theme.line, paddingHorizontal: 8, paddingVertical: 6, marginRight: 6, marginBottom: 8 },
  sigLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.5, textTransform: "uppercase", color: theme.ink2, marginTop: space(4), marginBottom: 6 },
  sigInput: { borderRadius: radius.md, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.bg, paddingHorizontal: space(3), paddingVertical: space(3), fontSize: 14, fontFamily: "Inter_400Regular", color: theme.ink },
  sigBtn: { alignItems: "center", justifyContent: "center", borderRadius: radius.md, paddingVertical: 13, paddingHorizontal: 20 },
});
