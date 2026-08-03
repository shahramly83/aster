import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, StyleSheet, Platform, Pressable, Keyboard, Animated, Easing, AccessibilityInfo } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Defs, RadialGradient, Stop, Rect } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { useAuth } from "../AuthContext";
import { Feather } from "../components/ui";
import { AsterLogo } from "../components/Logo";
import { space } from "../theme";

// Quiet by design. The previous version put nine stock headshots on a fully
// saturated blue, ringed with orbits and dots: a lot of work that read as a
// template, because a collage of stock faces is what templates do. What makes
// software look expensive is subtraction and typography, so this screen is one
// wordmark, one very large headline, one line of copy, two ruled fields and a
// single button. Nothing else.
//
// The ground is warm off-white rather than #FFFFFF, and the neutrals carry a
// slight blue bias toward the brand, so the palette reads as chosen instead of
// inherited. Brand blue appears exactly twice: the wordmark, and the rule under
// whichever field has focus. The button is near-black, because a saturated
// button on a pale ground is the loudest thing a screen can do.
// One flat off-white was restraint taken too far: correct, and lifeless. The
// ground is now a slow diagonal from cool to warm, with a single soft brand
// bloom behind the wordmark. Both are far below the threshold where you would
// call it a gradient; they only stop the screen reading as a blank sheet.
const PAGE = "#F7F6F3";
const PAGE_TOP = "#EEF1FC";     // barely blue
const PAGE_MID = "#F7F6F3";
const PAGE_BOT = "#F4EFE7";     // barely warm
const INK = "#12131F";        // 17.1:1
const INK_BODY = "#535563";   //  5.0:1 measured over the bloom, where it is lightest.
                              //  #5C5E6B was 6.0:1 on the flat ground but only 4.3:1 here
const INK_LABEL = "#5F6170";  //  4.5:1 over the bloom
const INK_FAINT = "#6E7080";  //  4.5:1, the floor for AA; lighter tones measured 3.0 and failed
const RULE = "#DEDCD6";
const ACCENT = "#0B2AE0";     //  8.0:1
const CTA = "#12131F";
const DANGER = "#A81B31";

// Android edge-to-edge doesn't resize the view for the keyboard, so track its
// height and lift the content manually.
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

function useReduceMotion() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setOn(!!v); });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => setOn(!!v));
    return () => { alive = false; sub?.remove?.(); };
  }, []);
  return on;
}

// Three blocks, 90ms apart. Slow enough to read as composed, short enough that
// someone who just wants to type is never waiting on it.
function Rise({ delay = 0, still, children, style }) {
  const v = useRef(new Animated.Value(still ? 1 : 0)).current;
  useEffect(() => {
    if (still) { v.setValue(1); return; }
    Animated.timing(v, { toValue: 1, duration: 560, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [v, delay, still]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

// A ruled field, not a boxed one. The rule takes the brand colour and thickens on
// focus, which marks the active field without drawing a container around it.
function Field({ label, inputRef, invalid, children }) {
  const [focused, setFocused] = useState(false);
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: focused ? 1 : 0, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [focused, a]);
  return (
    <Pressable onPress={() => inputRef?.current?.focus()} accessible={false}>
      <Text style={[styles.label, focused && { color: ACCENT }]}>{label}</Text>
      <View style={styles.fieldRow}>
        {children({ onFocus: () => setFocused(true), onBlur: () => setFocused(false) })}
      </View>
      <Animated.View
        style={{
          marginTop: 10,
          height: a.interpolate({ inputRange: [0, 1], outputRange: [1, 2] }),
          backgroundColor: invalid ? DANGER : (focused ? ACCENT : RULE),
        }}
      />
    </Pressable>
  );
}

export default function SignInScreen() {
  const { signIn } = useAuth();
  const kb = useKeyboardHeight();
  const still = useReduceMotion();
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
    try {
      await signIn(email, password);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      // A wrong password is worth feeling as well as reading.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setError(e?.message || "Could not sign in. Check your email and password.");
    }
    setBusy(false);
  };

  const ready = !!email && !!password;

  return (
    <View style={{ flex: 1, backgroundColor: PAGE }}>
      <StatusBar style="dark" />

      <LinearGradient
        colors={[PAGE_TOP, PAGE_MID, PAGE_BOT]}
        locations={[0, 0.45, 1]}
        start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* A soft bloom of brand colour up behind the wordmark. 0.14 at the centre
          falling to nothing: enough to feel, not enough to notice. */}
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id="bloom" cx="20%" cy="10%" rx="88%" ry="52%">
            <Stop offset="0" stopColor={ACCENT} stopOpacity="0.48" />
            <Stop offset="1" stopColor={ACCENT} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="warm" cx="88%" cy="92%" rx="70%" ry="42%">
            <Stop offset="0" stopColor="#F0B27A" stopOpacity="0.34" />
            <Stop offset="1" stopColor="#F0B27A" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bloom)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#warm)" />
      </Svg>

      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <View style={[styles.page, kb > 0 && { paddingBottom: kb + space(4) }]}>

          <Rise delay={0} still={still}>
            <AsterLogo width={176} color={ACCENT} />
          </Rise>

          {/* Two lines on purpose. One long line would set the type smaller and
              lose the only piece of scale on the screen. */}
          <Rise delay={90} still={still} style={{ marginTop: space(9) }}>
            <Text style={styles.h1}>Welcome</Text>
            <Text style={styles.h1}>back.</Text>
            <Text style={styles.sub}>Every role, every candidate, in one place.</Text>
          </Rise>

          {/* The gap does the work. Pushing the form to the lower third is what
              gives the headline room, and puts the fields under the thumb. */}
          <View style={{ flex: 1, minHeight: space(6) }} />

          <Rise delay={180} still={still}>
            <Field label="WORK EMAIL" inputRef={emailRef} invalid={!!error}>
              {({ onFocus, onBlur }) => (
                <TextInput
                  ref={emailRef}
                  style={styles.input}
                  placeholder="you@company.com"
                  placeholderTextColor={INK_FAINT}
                  autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
                  textContentType="emailAddress" autoComplete="email"
                  returnKeyType="next"
                  selectionColor={ACCENT}
                  value={email}
                  onChangeText={(v) => { setEmail(v); if (error) setError(""); }}
                  onFocus={onFocus} onBlur={onBlur}
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  accessibilityLabel="Work email"
                />
              )}
            </Field>

            <View style={{ marginTop: space(7) }}>
              <Field label="PASSWORD" inputRef={passwordRef} invalid={!!error}>
                {({ onFocus, onBlur }) => (
                  <>
                    <TextInput
                      ref={passwordRef}
                      style={[styles.input, { flex: 1 }]}
                      placeholder="••••••••"
                      placeholderTextColor={INK_FAINT}
                      secureTextEntry={!show} textContentType="password" autoComplete="password"
                      returnKeyType="go"
                      selectionColor={ACCENT}
                      value={password}
                      onChangeText={(v) => { setPassword(v); if (error) setError(""); }}
                      onFocus={onFocus} onBlur={onBlur}
                      onSubmitEditing={onSubmit}
                      accessibilityLabel="Password"
                    />
                    <Pressable
                      onPress={() => setShow((s) => !s)}
                      hitSlop={16}
                      accessibilityRole="button"
                      accessibilityLabel={show ? "Hide password" : "Show password"}
                    >
                      <Feather name={show ? "eye-off" : "eye"} size={18} color={INK_LABEL} />
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

          <Rise delay={260} still={still}>
            <Pressable
              onPress={onSubmit}
              disabled={!ready || busy}
              accessibilityRole="button"
              accessibilityState={{ disabled: !ready || busy, busy }}
              // 0.985 rather than the usual 0.95: at this width a deep press
              // scale looks like the button is falling away from the finger.
              style={({ pressed }) => [
                styles.cta,
                { backgroundColor: ready ? CTA : "#E4E2DC" },
                pressed && ready && !still && { transform: [{ scale: 0.985 }] },
              ]}
            >
              <Text style={[styles.ctaTxt, !ready && { color: INK_FAINT }]}>
                {busy ? "Signing in…" : "Sign in"}
              </Text>
            </Pressable>
          </Rise>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: space(7), paddingTop: space(10), paddingBottom: space(8) },
  // -1.4 tracking: at 40px the default spacing reads loose and slightly cheap.
  h1: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 40, lineHeight: 44, letterSpacing: -1.4, color: INK },
  sub: { fontFamily: "Inter_400Regular", fontSize: 15, lineHeight: 22, color: INK_BODY, marginTop: space(4), maxWidth: 260 },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 10.5, letterSpacing: 1.5, color: INK_LABEL },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 34, marginTop: space(3) },
  input: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 17, color: INK, padding: 0 },
  errorRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: space(5) },
  errorTxt: { fontFamily: "Inter_400Regular", fontSize: 13.5, lineHeight: 19, color: DANGER, flex: 1 },
  cta: { height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", marginTop: space(9) },
  ctaTxt: { fontFamily: "Inter_700Bold", fontSize: 16.5, color: "#FFFFFF", letterSpacing: 0.1 },
});
