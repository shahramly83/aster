import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, ScrollView, StyleSheet, Platform, Pressable, Keyboard, Animated, Easing, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useAuth } from "../AuthContext";
import { Feather } from "../components/ui";
import { AsterLogo } from "../components/Logo";
import FaceConstellation from "../components/FaceConstellation";
import { theme, space } from "../theme";

// The screen leads with people, not with the brand: nine faces on slow orbits
// over a pale ground, with the form sitting underneath on the same page. The old
// version was edge-to-edge brand blue, which looked confident but said nothing
// about what the product is for.
const PAGE = "#F4F7FC";
const INK = "#0E1220";
const INK_DIM = "#6B7385";
const INK_FAINT = "#9AA2B4";
const RULE = "#D5DCEA";
const RULE_ON = "#0B2AE0";
const SURFACE_OFF = "#DFE5F0"; // disabled button fill
const DANGER = "#C0233A";

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
  const { height: winH } = useWindowDimensions();
  const scrollRef = useRef(null);
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

  // The artwork gives up its height to the keyboard rather than pushing the
  // fields off-screen. Height can't run on the native driver, but this animates
  // once per keyboard event, not per frame of typing.
  const artFull = Math.round(winH * 0.47);
  const artH = useRef(new Animated.Value(artFull)).current;
  useEffect(() => {
    Animated.timing(artH, {
      toValue: kb > 0 ? Math.round(artFull * 0.34) : artFull,
      duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start();
  }, [kb, artFull, artH]);

  return (
    <View style={{ flex: 1, backgroundColor: PAGE }}>
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.scroll, kb > 0 && { paddingBottom: kb + space(4) }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          {/* Bleeds the full width; the form below keeps the page margin. */}
          <Animated.View style={{ height: artH, overflow: "hidden", marginHorizontal: -space(7) }}>
            <FaceConstellation height={artFull} />
          </Animated.View>

          <View style={styles.form}>
            <Rise delay={220}><AsterLogo width={116} color={theme.brand} /></Rise>
            <Rise delay={290}><Text style={styles.h1}>Welcome back.</Text></Rise>
            <Rise delay={350}><Text style={styles.sub}>Hiring, all in one tap.</Text></Rise>

            <Rise delay={420} style={{ marginTop: space(8) }}>
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

              <View style={{ marginTop: space(6) }}>
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
                        onFocus={() => { onFocus(); setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120); }}
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
                {!busy ? <Feather name="arrow-right" size={18} color={ready ? "#FFFFFF" : INK_FAINT} /> : null}
              </Pressable>
            </Rise>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, paddingHorizontal: space(7), paddingBottom: space(10) },
  form: { marginTop: space(4) },
  h1: {
    fontFamily: "PlusJakartaSans_700Bold", fontSize: 29, lineHeight: 35, letterSpacing: -0.8,
    color: INK, marginTop: space(4),
  },
  sub: { fontFamily: "Inter_400Regular", fontSize: 15.5, color: INK_DIM, marginTop: space(2) },
  field: { paddingBottom: 10 },
  fieldLabel: { fontFamily: "Inter_600SemiBold", fontSize: 10.5, letterSpacing: 1.4, color: INK_DIM, marginBottom: 12 },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 30 },
  input: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 17, color: INK, padding: 0 },
  rule: { marginTop: 10, borderRadius: 1 },
  errorRow: {
    flexDirection: "row", alignItems: "flex-start",
    backgroundColor: "#FDECEF", borderRadius: 14, padding: 12, marginTop: space(6),
  },
  errorTxt: { fontFamily: "Inter_400Regular", fontSize: 13.5, lineHeight: 19, color: DANGER, marginLeft: 8, flex: 1 },
  cta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    height: 58, borderRadius: 18, marginTop: space(9),
  },
  ctaOn: {
    backgroundColor: theme.brand,
    shadowColor: "#0B2AE0", shadowOpacity: 0.32, shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 }, elevation: 8,
  },
  ctaOff: { backgroundColor: SURFACE_OFF },
  ctaTxt: { fontFamily: "Inter_700Bold", fontSize: 16.5, color: "#FFFFFF" },
});
