import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, StyleSheet, Platform, Pressable, Keyboard, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useAuth } from "../AuthContext";
import { Feather } from "../components/ui";
import { AsterLogo } from "../components/Logo";
import FaceConstellation from "../components/FaceConstellation";
import { space } from "../theme";

// The screen leads with people, not with the brand: nine faces on slow orbits
// over a pale ground, with the form sitting underneath on the same page. The old
// version was edge-to-edge brand blue, which looked confident but said nothing
// about what the product is for.
// Two grounds for the same screen. Flip SKIN to compare: "sky" is a pale blue
// page with dark type, "brand" is the deep brand blue with everything laid over
// it in white at graded opacities.
const SKIN = "sky";

const SKINS = {
  sky: {
    // A light blue with real weight, not a near-white tint. Deep enough that the
    // white orbit rings and photo rims read as light against it (2.1:1), still
    // light enough to carry dark type at 8.8:1.
    page: "#98B4E0",
    ink: "#0E1220",
    inkDim: "#2E3A50",
    inkFaint: "#35415A",   // 4.8:1. Every tone here was picked by measuring, not by eye
    rule: "#6683B4",
    ruleOn: "#0B2AE0",
    surfaceOff: "#84A0CF",
    danger: "#A81B31",
    errorBg: "#F6DDE1",
    ring: "rgba(255,255,255,0.95)",
    dotA: "#0B2AE0",
    dotB: "#7E97FF",
    logo: "#0B2AE0",
    ctaBg: "#0B2AE0",
    ctaTxt: "#FFFFFF",
    bar: "dark",
  },
  brand: {
    page: "#0B2AE0",
    // Light blue rather than white: on this ground pure white type is glarier
    // than it needs to be, and the tint ties the copy to the artwork. Still
    // ~12:1 against #0B2AE0, so it clears AA with room to spare.
    ink: "#DCE7FF",
    inkDim: "#A8C0FF",
    inkFaint: "#A6BDFF",   // 4.7:1, so placeholders and icons still clear AA
    rule: "rgba(168,192,255,0.42)",
    ruleOn: "#DCE7FF",
    surfaceOff: "rgba(255,255,255,0.14)",
    danger: "#FFC2C6",
    errorBg: "rgba(0,0,0,0.22)",
    ring: "rgba(255,255,255,0.26)",
    dotA: "#DCE7FF",
    dotB: "#7E97FF",
    logo: "#DCE7FF",
    ctaBg: "#FFFFFF",
    ctaTxt: "#0B2AE0",
    bar: "light",
  },
};

const S = SKINS[SKIN];
const PAGE = S.page;
const INK = S.ink;
const INK_DIM = S.inkDim;
const INK_FAINT = S.inkFaint;
const RULE = S.rule;
const RULE_ON = S.ruleOn;
const SURFACE_OFF = S.surfaceOff;
const DANGER = S.danger;

// Android edge-to-edge doesn't resize the view for the keyboard, so track its
// height and lift the scroll content above it manually.
function useKeyboardHeight() {
  const [h, setH] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const s = Keyboard.addListener(showEvt, (e) => setH(e.endCoordinates?.height || 0));
    const hd = Keyboard.addListener(hideEvt, () => setH(0));
    return () => { s.remove(); hd.remove(); };
  }, []);
  return h;
}

// Blocks arrive in sequence rather than all at once. A single fade of the whole
// screen reads as a page that loaded; a 70ms cascade reads as a screen being
// built, which is most of the difference between "clean" and "flat".
function Rise({ delay = 0, children, style }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 520, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [v, delay]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

// An underlined field. The rule animates to brand blue and thickens on focus, so
// the active field is unmistakable without drawing a box around it.
function Field({ label, icon, inputRef, invalid, children }) {
  const [focused, setFocused] = useState(false);
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: focused ? 1 : 0, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [focused, a]);

  return (
    <Pressable onPress={() => inputRef?.current?.focus()} style={styles.field}>
      <Text style={[styles.fieldLabel, focused && { color: RULE_ON }]}>{label}</Text>
      <View style={styles.fieldRow}>
        <Feather name={icon} size={17} color={focused ? RULE_ON : INK_FAINT} />
        {children({ onFocus: () => setFocused(true), onBlur: () => setFocused(false) })}
      </View>
      <Animated.View
        style={[
          styles.rule,
          {
            height: a.interpolate({ inputRange: [0, 1], outputRange: [1, 2] }),
            backgroundColor: invalid ? DANGER : (focused ? RULE_ON : RULE),
          },
        ]}
      />
    </Pressable>
  );
}

export default function SignInScreen() {
  const { signIn } = useAuth();
  const kb = useKeyboardHeight();
  const emailRef = useRef(null);
  const passwordRef = useRef(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async () => {
    if (!email || !password || busy) return;
    Keyboard.dismiss();
    setError(""); setBusy(true);
    try { await signIn(email, password); }
    catch (e) { setError(e?.message || "Could not sign in. Check your email and password."); }
    finally { setBusy(false); }
  };

  const ready = !!email && !!password;

  // The artwork takes whatever height is left after the form, measured rather
  // than assumed, so the screen fits exactly once on any device and never
  // scrolls. Below the floor the box clips from the bottom instead of squashing
  // the arrangement, which keeps the faces circular and evenly spread.
  const [artH, setArtH] = useState(0);
  const ART_FLOOR = 210;

  return (
    <View style={{ flex: 1, backgroundColor: PAGE }}>
      <StatusBar style={S.bar} />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        {/* Android edge-to-edge doesn't resize for the keyboard, so the padding
            does it, and the flexible artwork above absorbs the loss. */}
        <View style={[styles.page, kb > 0 && { paddingBottom: kb }]}>
          {/* Bleeds the full width; the form below keeps the page margin. */}
          <View
            style={styles.art}
            onLayout={(e) => setArtH(Math.round(e.nativeEvent.layout.height))}
          >
            {artH > 0 ? <FaceConstellation height={Math.max(artH, ART_FLOOR)} ring={S.ring} dotA={S.dotA} dotB={S.dotB} /> : null}
          </View>

          <View style={styles.form}>
            <Rise delay={220}><AsterLogo width={116} color={S.logo} /></Rise>
            <Rise delay={290}><Text style={styles.h1}>Welcome back.</Text></Rise>
            <Rise delay={350}><Text style={styles.sub}>Hiring, all in one tap.</Text></Rise>

            <Rise delay={420} style={{ marginTop: space(6) }}>
              <Field label="WORK EMAIL" icon="mail" inputRef={emailRef} invalid={!!error}>
                {({ onFocus, onBlur }) => (
                  <TextInput
                    ref={emailRef}
                    style={styles.input}
                    placeholder="you@company.com"
                    placeholderTextColor={INK_FAINT}
                    autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
                    textContentType="emailAddress" autoComplete="email"
                    returnKeyType="next"
                    selectionColor={RULE_ON}
                    value={email}
                    onChangeText={(v) => { setEmail(v); if (error) setError(""); }}
                    onFocus={onFocus} onBlur={onBlur}
                    onSubmitEditing={() => passwordRef.current?.focus()}
                    accessibilityLabel="Work email"
                  />
                )}
              </Field>

              <View style={{ marginTop: space(5) }}>
                <Field label="PASSWORD" icon="lock" inputRef={passwordRef} invalid={!!error}>
                  {({ onFocus, onBlur }) => (
                    <>
                      <TextInput
                        ref={passwordRef}
                        style={styles.input}
                        placeholder="••••••••"
                        placeholderTextColor={INK_FAINT}
                        secureTextEntry={!show} textContentType="password" autoComplete="password"
                        returnKeyType="go"
                        selectionColor={RULE_ON}
                        value={password}
                        onChangeText={(v) => { setPassword(v); if (error) setError(""); }}
                        onFocus={onFocus}
                        onBlur={onBlur}
                        onSubmitEditing={onSubmit}
                        accessibilityLabel="Password"
                      />
                      <Pressable
                        onPress={() => setShow((s) => !s)}
                        hitSlop={14}
                        accessibilityRole="button"
                        accessibilityLabel={show ? "Hide password" : "Show password"}
                      >
                        <Feather name={show ? "eye-off" : "eye"} size={17} color={INK_FAINT} />
                      </Pressable>
                    </>
                  )}
                </Field>
              </View>
            </Rise>

            {error ? (
              <View style={styles.errorRow} accessibilityLiveRegion="polite" accessibilityRole="alert">
                <Feather name="alert-circle" size={15} color={DANGER} style={{ marginTop: 1 }} />
                <Text style={styles.errorTxt}>{error}</Text>
              </View>
            ) : null}

            {/* One action, and it looks like the only thing on the screen worth
                pressing. */}
            <Rise delay={490}>
              <Pressable
                onPress={onSubmit}
                disabled={!ready || busy}
                accessibilityRole="button"
                accessibilityState={{ disabled: !ready || busy, busy }}
                style={({ pressed }) => [
                  styles.cta,
                  ready ? styles.ctaOn : styles.ctaOff,
                  pressed && ready && { opacity: 0.9 },
                ]}
              >
                <Text style={[styles.ctaTxt, !ready && { color: INK_FAINT }]}>
                  {busy ? "Signing in…" : "Sign in"}
                </Text>
                {!busy ? <Feather name="arrow-right" size={18} color={ready ? S.ctaTxt : INK_FAINT} /> : null}
              </Pressable>
            </Rise>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: space(7), paddingBottom: space(4) },
  // flexShrink lets the artwork give up height to the keyboard; minHeight 0 is
  // what actually allows a flex child to shrink below its content.
  art: { flex: 1, minHeight: 0, overflow: "hidden", marginHorizontal: -space(7) },
  form: { flexShrink: 0, paddingTop: space(2) },
  h1: {
    fontFamily: "PlusJakartaSans_700Bold", fontSize: 29, lineHeight: 35, letterSpacing: -0.8,
    color: INK, marginTop: space(3),
  },
  sub: { fontFamily: "Inter_400Regular", fontSize: 15.5, color: INK_DIM, marginTop: space(2) },
  field: { paddingBottom: 10 },
  fieldLabel: { fontFamily: "Inter_600SemiBold", fontSize: 10.5, letterSpacing: 1.4, color: INK_DIM, marginBottom: 12 },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 30 },
  input: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 17, color: INK, padding: 0 },
  rule: { marginTop: 10, borderRadius: 1 },
  errorRow: {
    flexDirection: "row", alignItems: "flex-start",
    backgroundColor: S.errorBg, borderRadius: 14, padding: 12, marginTop: space(6),
  },
  errorTxt: { fontFamily: "Inter_400Regular", fontSize: 13.5, lineHeight: 19, color: DANGER, marginLeft: 8, flex: 1 },
  cta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    height: 56, borderRadius: 18, marginTop: space(6),
  },
  ctaOn: {
    backgroundColor: S.ctaBg,
    shadowColor: "#050B3D", shadowOpacity: 0.32, shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 }, elevation: 8,
  },
  ctaOff: { backgroundColor: SURFACE_OFF },
  ctaTxt: { fontFamily: "Inter_700Bold", fontSize: 16.5, color: S.ctaTxt },
});
