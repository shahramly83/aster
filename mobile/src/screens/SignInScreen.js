import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, ScrollView, StyleSheet, Platform, Pressable, Keyboard, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { useAuth } from "../AuthContext";
import { Feather } from "../components/ui";
import { AsterLogo, AsterMark } from "../components/Logo";
import { theme, space } from "../theme";

// Brand blue edge to edge: no white card floating on it, no boxed inputs. One
// very large headline and fields drawn as ruled lines, straight on the blue. The
// colour carries the screen, so everything laid over it is white at graded
// opacities rather than another surface.
const PAGE = "#0B2AE0";
const TEXT = "#FFFFFF";
const TEXT_DIM = "rgba(255,255,255,0.72)";
const TEXT_FAINT = "rgba(255,255,255,0.48)";
const RULE = "rgba(255,255,255,0.28)";
const SURFACE_OFF = "rgba(255,255,255,0.14)"; // disabled button fill
const DANGER = "#FFC2C6";

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
      <Text style={[styles.fieldLabel, focused && { color: TEXT }]}>{label}</Text>
      <View style={styles.fieldRow}>
        <Feather name={icon} size={17} color={focused ? TEXT : TEXT_FAINT} />
        {children({ onFocus: () => setFocused(true), onBlur: () => setFocused(false) })}
      </View>
      <Animated.View
        style={[
          styles.rule,
          {
            backgroundColor: invalid ? DANGER : a.interpolate({ inputRange: [0, 1], outputRange: [RULE, TEXT] }),
            height: a.interpolate({ inputRange: [0, 1], outputRange: [1, 2] }),
          },
        ]}
      />
    </Pressable>
  );
}

export default function SignInScreen() {
  const { signIn } = useAuth();
  const kb = useKeyboardHeight();
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

  // Two loops on the background mark: one full turn every 90s, and a 7s breathe.
  // Both run on the native driver so nothing here touches the JS thread while
  // someone is typing.
  const spin = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const turn = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 90000, easing: Easing.linear, useNativeDriver: true })
    );
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 3500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 3500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    turn.start(); pulse.start();
    return () => { turn.stop(); pulse.stop(); };
  }, [spin, breathe]);

  return (
    <View style={{ flex: 1, backgroundColor: PAGE }}>
      <StatusBar style="light" />
      {/* The gradient IS the page, not a panel behind a card. Everything sits
          straight on it. */}
      <LinearGradient
        colors={["#2B5BFF", "#0B2AE0", "#0A1E9E"]}
        start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* One big mark bleeding off the top-right corner, above the form and clear
          of the button. It turns once every 90 seconds and breathes slightly:
          slow enough that you never catch it moving, but the screen is never
          quite still either. Background geometry must not pull the eye off the
          form, so both the speed and the contrast stay very low. */}
      <Animated.View
        style={[
          styles.mark,
          {
            opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }),
            transform: [
              { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) },
              { scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) },
            ],
          },
        ]}
        pointerEvents="none"
      >
        <AsterMark size={340} color="rgba(255,255,255,0.06)" />
      </Animated.View>

      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.scroll, kb > 0 && { paddingBottom: kb + space(4) }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          <View>
            <Rise delay={0}><AsterLogo width={150} color={TEXT} /></Rise>
            <Rise delay={90}><Text style={styles.h1}>Welcome back.</Text></Rise>
            <Rise delay={160}><Text style={styles.sub}>All in one tap.</Text></Rise>


            <Rise delay={240} style={{ marginTop: space(9) }}>
              <Field label="WORK EMAIL" icon="mail" inputRef={emailRef} invalid={!!error}>
                {({ onFocus, onBlur }) => (
                  <TextInput
                    ref={emailRef}
                    style={styles.input}
                    placeholder="you@company.com"
                    placeholderTextColor={TEXT_FAINT}
                    autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
                    textContentType="emailAddress" autoComplete="email"
                    returnKeyType="next"
                    selectionColor={TEXT}
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
                        placeholderTextColor={TEXT_FAINT}
                        secureTextEntry={!show} textContentType="password" autoComplete="password"
                        returnKeyType="go"
                        selectionColor={TEXT}
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
                        <Feather name={show ? "eye-off" : "eye"} size={17} color={TEXT_FAINT} />
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
                pressing. Disabled is a flat raised surface, not a washed-out tint
                of the brand colour. */}
            <Rise delay={320}>
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
              <Text style={[styles.ctaTxt, !ready && { color: TEXT_FAINT }]}>
                {busy ? "Signing in…" : "Sign in"}
              </Text>
              {!busy ? <Feather name="arrow-right" size={18} color={ready ? theme.brand : TEXT_FAINT} /> : null}
            </Pressable>
            </Rise>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Top right, well clear of the form and the button below it. Only the lower
  // arms reach into the screen, so it frames the header rather than sitting
  // behind anything you have to read or press.
  mark: { position: "absolute", top: -150, right: -150 },
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: space(7), paddingVertical: space(10) },
  // Left-aligned, sharing the same left edge as the labels and inputs below.
  // Centring the brand and left-aligning the form left two competing axes on one
  // screen, which is what made it feel off.
  brand: { alignItems: "flex-start" },
  h1: {
    fontFamily: "PlusJakartaSans_700Bold", fontSize: 27, lineHeight: 33, letterSpacing: -0.7,
    color: TEXT, marginTop: space(5),
  },
  sub: { fontFamily: "Inter_400Regular", fontSize: 15.5, color: TEXT_DIM, marginTop: space(2) },
  field: { paddingBottom: 10 },
  fieldLabel: { fontFamily: "Inter_600SemiBold", fontSize: 10.5, letterSpacing: 1.4, color: TEXT_FAINT, marginBottom: 12 },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 30 },
  input: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 17, color: TEXT, padding: 0 },
  rule: { marginTop: 10, borderRadius: 1 },
  errorRow: {
    flexDirection: "row", alignItems: "flex-start",
    backgroundColor: "rgba(0,0,0,0.22)", borderRadius: 14, padding: 12, marginTop: space(6),
  },
  errorTxt: { fontFamily: "Inter_400Regular", fontSize: 13.5, lineHeight: 19, color: DANGER, marginLeft: 8, flex: 1 },
  cta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    height: 58, borderRadius: 18, marginTop: space(9),
  },
  ctaOn: {
    backgroundColor: TEXT,
    shadowColor: "#050B3D", shadowOpacity: 0.3, shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 }, elevation: 8,
  },
  ctaOff: { backgroundColor: SURFACE_OFF },
  ctaTxt: { fontFamily: "Inter_700Bold", fontSize: 16.5, color: theme.brand },
});
