import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, ScrollView, StyleSheet, Platform, Pressable, Keyboard, Linking, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { useAuth } from "../AuthContext";
import { Button, Feather } from "../components/ui";
import { AsterLogo, AsterMark } from "../components/Logo";
import { theme, type, radius, space } from "../theme";

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

// A field that shows where focus is. The old inputs had no focus state at all:
// tapping one changed nothing on screen, so on a two-field form you could lose
// track of which one the keyboard was typing into.
function Field({ label, icon, inputRef, invalid, children }) {
  const [focused, setFocused] = useState(false);
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        onPress={() => inputRef?.current?.focus()}
        style={[styles.inputWrap, focused && styles.inputWrapFocused, invalid && styles.inputWrapError]}
      >
        <Feather name={icon} size={18} color={focused ? theme.brand : theme.ink4} />
        {children({ onFocus: () => setFocused(true), onBlur: () => setFocused(false) })}
      </Pressable>
    </View>
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

  // The sheet rises once on mount. One element, one movement: enough to feel
  // deliberate without making anyone wait to sign in.
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(rise, { toValue: 1, duration: 460, delay: 90, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [rise]);

  const onSubmit = async () => {
    if (!email || !password || busy) return;
    Keyboard.dismiss();
    setError(""); setBusy(true);
    try { await signIn(email, password); }
    catch (e) { setError(e?.message || "Could not sign in. Check your email and password."); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.brand }}>
      <StatusBar style="light" />
      <LinearGradient colors={["#2B5BFF", "#0B2AE0", "#081A87"]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
      {/* ONE mark, low and to the right, mostly tucked behind the sheet. The
          earlier pair sat high and cropped against the logo, so the brand read as
          a mistake rather than a backdrop. */}
      <View style={styles.mark} pointerEvents="none"><AsterMark size={260} color="rgba(255,255,255,0.08)" /></View>

      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.scroll, kb > 0 && { paddingBottom: kb }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Brand canvas. The wordmark alone said who this was; the line under
              it says what you are signing in to do. */}
          <View style={styles.brand}>
            <AsterLogo width={132} color={theme.white} />
            <Text style={styles.tagline}>Your hiring pipeline,{"\n"}wherever you are.</Text>
          </View>

          {/* The form sits on a sheet running off the bottom of the screen rather
              than a card floating in the middle of a gradient, so it reads as
              part of the app instead of a dialog laid over a poster. */}
          <Animated.View
            style={[
              styles.sheet,
              { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) }] },
            ]}
          >
            <Text style={styles.sheetTitle}>Sign in</Text>

            <Field label="Work email" icon="mail" inputRef={emailRef} invalid={!!error}>
              {({ onFocus, onBlur }) => (
                <TextInput
                  ref={emailRef}
                  style={styles.input}
                  placeholder="you@company.com"
                  placeholderTextColor={theme.ink4}
                  autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
                  textContentType="emailAddress" autoComplete="email"
                  returnKeyType="next"
                  value={email}
                  onChangeText={(v) => { setEmail(v); if (error) setError(""); }}
                  onFocus={onFocus} onBlur={onBlur}
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  accessibilityLabel="Work email"
                />
              )}
            </Field>

            <View style={{ marginTop: space(4) }}>
              <Field label="Password" icon="lock" inputRef={passwordRef} invalid={!!error}>
                {({ onFocus, onBlur }) => (
                  <>
                    <TextInput
                      ref={passwordRef}
                      style={styles.input}
                      placeholder="••••••••"
                      placeholderTextColor={theme.ink4}
                      secureTextEntry={!show} textContentType="password" autoComplete="password"
                      returnKeyType="go"
                      value={password}
                      onChangeText={(v) => { setPassword(v); if (error) setError(""); }}
                      onFocus={() => { onFocus(); setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120); }}
                      onBlur={onBlur}
                      onSubmitEditing={onSubmit}
                      accessibilityLabel="Password"
                    />
                    <Pressable
                      onPress={() => setShow((s) => !s)}
                      hitSlop={12}
                      accessibilityRole="button"
                      accessibilityLabel={show ? "Hide password" : "Show password"}
                    >
                      <Feather name={show ? "eye-off" : "eye"} size={18} color={theme.ink4} />
                    </Pressable>
                  </>
                )}
              </Field>
            </View>

            {error ? (
              <View style={styles.errorRow} accessibilityLiveRegion="polite" accessibilityRole="alert">
                <Feather name="alert-circle" size={15} color={theme.danger} style={{ marginTop: 1 }} />
                <Text style={[type.small, { color: theme.danger, marginLeft: 8, flex: 1, lineHeight: 19 }]}>{error}</Text>
              </View>
            ) : null}

            <Button
              title="Sign in"
              onPress={onSubmit}
              loading={busy}
              disabled={!email || !password}
              style={{ marginTop: space(5) }}
            />

            {/* A tappable route out, not a sentence about one. Resetting a
                password was described in the footer and left you to find
                hireaster.com yourself. */}
            <Pressable
              onPress={() => Linking.openURL("https://hireaster.com/login")}
              hitSlop={8}
              style={styles.forgot}
              accessibilityRole="link"
              accessibilityLabel="Reset your password on hireaster.com"
            >
              <Text style={styles.forgotTxt}>Forgot password?</Text>
            </Pressable>

            <View style={styles.ssoNote}>
              <Feather name="shield" size={13} color={theme.ink4} />
              <Text style={styles.ssoTxt}>Single sign-on is handled on hireaster.com</Text>
            </View>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { position: "absolute", top: 90, right: -80 },
  scroll: { flexGrow: 1, justifyContent: "flex-end" },
  brand: { paddingHorizontal: space(6), paddingTop: space(8), paddingBottom: space(7) },
  tagline: {
    fontFamily: "PlusJakartaSans_700Bold", fontSize: 27, lineHeight: 34, letterSpacing: -0.7,
    color: theme.white, marginTop: space(4),
  },
  sheet: {
    backgroundColor: theme.card,
    borderTopLeftRadius: 34, borderTopRightRadius: 34,
    paddingHorizontal: space(6), paddingTop: space(6), paddingBottom: space(6),
    shadowColor: "#050B3D", shadowOpacity: 0.3, shadowRadius: 34,
    shadowOffset: { width: 0, height: -10 }, elevation: 24,
  },
  sheetTitle: {
    fontFamily: "PlusJakartaSans_700Bold", fontSize: 22, letterSpacing: -0.5,
    color: theme.ink, marginBottom: space(4),
  },
  fieldLabel: { ...type.smallStrong, color: theme.ink2, marginBottom: 8 },
  inputWrap: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: theme.bg, borderWidth: 1.5, borderColor: theme.line,
    borderRadius: radius.md, paddingHorizontal: 14, height: 52,
  },
  // Focus and error are carried by border AND fill, so neither depends on colour
  // alone to register.
  inputWrapFocused: { borderColor: theme.brand, backgroundColor: theme.card },
  inputWrapError: { borderColor: theme.danger },
  input: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 16, color: theme.ink },
  errorRow: {
    flexDirection: "row", alignItems: "flex-start",
    backgroundColor: theme.dangerBg, borderRadius: radius.md, padding: 12, marginTop: space(4),
  },
  forgot: { alignSelf: "center", marginTop: space(3), paddingVertical: 8, paddingHorizontal: 12 },
  forgotTxt: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: theme.brand },
  ssoNote: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: space(2) },
  ssoTxt: { fontFamily: "Inter_400Regular", fontSize: 12.5, color: theme.ink4, marginLeft: 6 },
});
