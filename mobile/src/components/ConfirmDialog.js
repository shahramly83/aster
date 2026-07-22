// The one dialog in the app. Used directly where a screen already holds its own
// state, and through useDialog() (components/Dialog.js) everywhere else.
//
// Shape: the card rises from the bottom on a blurred scrim, with a coloured
// hairline along its top edge and the icon straddling that edge so the medallion
// breaks the card's outline. That overhang is the whole idea — it stops the
// dialog reading as a rectangle of text and makes the intent (question, danger,
// done) legible before a word is read. An OS Alert can express none of this.
//
// `alertOnly` collapses it to one acknowledge button, so a notice and a question
// are recognisably the same object rather than one being a system box.
import React, { useEffect, useRef } from "react";
import { View, Text, Modal, Pressable, ActivityIndicator, Animated, Easing, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "./ui";
import { theme, type, space, radius } from "../theme";

const VARIANTS = {
  primary: { accent: theme.brand, tint: theme.brandSoft, icon: "help-circle" },
  danger: { accent: theme.danger, tint: theme.dangerBg, icon: "alert-triangle" },
  success: { accent: theme.success, tint: theme.successBg, icon: "check-circle" },
  warn: { accent: theme.warn, tint: theme.warnBg, icon: "alert-circle" },
};

export default function ConfirmDialog({
  visible, title, message, icon, detail,
  confirmLabel = "Confirm", cancelLabel = "Cancel",
  variant = "primary", // primary | danger | success | warn
  alertOnly = false,
  busy = false,
  onConfirm, onCancel,
}) {
  const v = VARIANTS[variant] || VARIANTS.primary;
  const insets = useSafeAreaInsets();
  const a = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(a, {
      toValue: visible ? 1 : 0,
      duration: visible ? 260 : 160, // exits quicker than it enters
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [visible, a]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={() => !busy && onCancel?.()} statusBarTranslucent>
      {/* Scrim fades with the card rather than snapping in, so the dialog reads
          as a layer settling over your work rather than a new screen. */}
      <Animated.View pointerEvents="none" style={[styles.fill, { opacity: a }]} />

      <Pressable style={styles.wrap} onPress={() => !busy && onCancel?.()} accessibilityLabel="Dismiss">
        <Animated.View
          style={[
            styles.cardWrap,
            { paddingBottom: Math.max(insets.bottom, 14) },
            { opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] },
          ]}
        >
          <Pressable style={styles.card} onPress={() => {}}>
            {/* Intent as a colour band on the top edge, readable before the words. */}
            <View style={[styles.rail, { backgroundColor: v.accent }]} />

            {/* The medallion sits half above the card, breaking its outline. */}
            <View style={[styles.medallion, { backgroundColor: v.tint, borderColor: theme.card }]}>
              <Feather name={icon || v.icon} size={22} color={v.accent} />
            </View>

            <Text style={styles.title}>{title}</Text>
            {message ? <Text style={styles.message}>{message}</Text> : null}

            {/* The specific thing being acted on (a time, a name), so it reads as
                data rather than another sentence of prose. */}
            {detail ? (
              <View style={[styles.detail, { borderLeftColor: v.accent }]}>
                <Text style={styles.detailTxt}>{detail}</Text>
              </View>
            ) : null}

            <Pressable
              onPress={() => !busy && onConfirm?.()}
              disabled={busy}
              style={({ pressed }) => [styles.primary, { backgroundColor: v.accent }, pressed && { opacity: 0.88 }, busy && { opacity: 0.7 }]}
              accessibilityRole="button"
            >
              {busy ? <ActivityIndicator size="small" color={theme.white} />
                : <Text style={styles.primaryTxt}>{alertOnly && confirmLabel === "Confirm" ? "Got it" : confirmLabel}</Text>}
            </Pressable>

            {/* Cancel is a quiet text button, not a second slab: one action is
                the point of the dialog and the other is a way out. */}
            {alertOnly ? null : (
              <Pressable onPress={() => !busy && onCancel?.()} disabled={busy} style={styles.cancel} accessibilityRole="button">
                <Text style={styles.cancelTxt}>{cancelLabel}</Text>
              </Pressable>
            )}
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(10,14,40,0.45)" },
  wrap: { flex: 1, justifyContent: "flex-end" },
  cardWrap: { paddingHorizontal: space(4) },
  card: {
    backgroundColor: theme.card, borderRadius: 28,
    paddingHorizontal: space(5), paddingTop: space(6), paddingBottom: space(4),
    alignItems: "center",   // no overflow:hidden — it would clip the medallion overhang
    shadowColor: "#0A0E28", shadowOpacity: 0.22, shadowRadius: 28, shadowOffset: { width: 0, height: 12 }, elevation: 16,
  },
  // Rounded to match the card, since the card can no longer clip it.
  rail: { position: "absolute", top: 0, left: 0, right: 0, height: 4, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  // Overlaps the top edge by half its height, so it breaks the card outline.
  medallion: {
    position: "absolute", top: -22, alignSelf: "center",
    width: 52, height: 52, borderRadius: 26, borderWidth: 4,
    alignItems: "center", justifyContent: "center",
  },
  title: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 19, letterSpacing: -0.4, color: theme.ink, textAlign: "center", marginTop: space(3) },
  message: { fontFamily: "Inter_400Regular", fontSize: 14.5, lineHeight: 21, color: theme.ink3, textAlign: "center", marginTop: 6 },
  detail: { alignSelf: "stretch", backgroundColor: theme.bg, borderRadius: radius.md, borderLeftWidth: 3, paddingHorizontal: 14, paddingVertical: 12, marginTop: space(3) },
  detailTxt: { ...type.bodyStrong, color: theme.ink },
  primary: { alignSelf: "stretch", height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", marginTop: space(4) },
  primaryTxt: { fontFamily: "Inter_700Bold", fontSize: 15.5, color: theme.white },
  cancel: { alignSelf: "stretch", minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 2 },
  cancelTxt: { ...type.bodyStrong, color: theme.ink3 },
});
