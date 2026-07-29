// The one prompt in the app. Used directly where a screen already holds its own
// state, and through useDialog() (components/Dialog.js) everywhere else.
//
// A sheet that slides up over the dimmed screen and takes about half of it.
// Half rather than full: the screen behind stays visible, so the prompt reads as
// a question about what you were doing rather than a new place you've been sent
// to, and the actions still land in the thumb's natural reach. A small centred
// card, system or otherwise, buries the decision mid-display and puts its
// buttons where you have to stretch.
//
// `alertOnly` collapses it to a single acknowledge button, so a notice and a
// question are recognisably the same object.
import React from "react";
import { View, Text, Modal, Pressable, ActivityIndicator, StyleSheet } from "react-native";
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

  return (
    // animationType="slide" gives the native bottom-up transition, and it stays
    // interruptible in a way a hand-rolled Animated sheet does not.
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={() => !busy && onCancel?.()}>
      {/* Tapping the dimmed area dismisses, which for a question means "no" —
          never the destructive branch. */}
      <Pressable style={styles.backdrop} onPress={() => !busy && onCancel?.()} accessibilityLabel="Dismiss">
      <Pressable style={[styles.screen, { paddingBottom: Math.max(insets.bottom, 12) + space(3) }]} onPress={() => {}}>
        {/* Grab handle: says the sheet came from the bottom edge and can go back. */}
        <View style={styles.grabber} />

        <View style={styles.body}>
          <View style={[styles.medallion, { backgroundColor: v.tint }]}>
            <Feather name={icon || v.icon} size={22} color={v.accent} />
          </View>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}

          {/* The specific thing being acted on (a time, a credit cost), so it
              reads as data rather than another sentence of prose. */}
          {detail ? (
            <View style={[styles.detail, { borderLeftColor: v.accent }]}>
              <Text style={styles.detailTxt}>{detail}</Text>
            </View>
          ) : null}
        </View>

        {/* Actions pinned to the bottom, in the thumb's natural reach. */}
        <View style={styles.actions}>
          <Pressable
            onPress={() => !busy && onConfirm?.()}
            disabled={busy}
            style={({ pressed }) => [styles.primary, { backgroundColor: v.accent }, pressed && { opacity: 0.9 }, busy && { opacity: 0.7 }]}
            accessibilityRole="button"
          >
            {busy ? <ActivityIndicator size="small" color={theme.white} />
              : <Text style={styles.primaryTxt}>{alertOnly && confirmLabel === "Confirm" ? "Got it" : confirmLabel}</Text>}
          </Pressable>

          {/* Cancel is quiet text, not a second slab: one action is the point of
              the screen and the other is a way out. */}
          {alertOnly ? null : (
            <Pressable onPress={() => !busy && onCancel?.()} disabled={busy} style={styles.cancel} accessibilityRole="button">
              <Text style={styles.cancelTxt}>{cancelLabel}</Text>
            </Pressable>
          )}
        </View>
      </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // No scrim. The sheet's own elevation and the screen edge are enough to
  // separate it, and dimming the work behind made the prompt feel heavier than
  // the question it usually asks.
  backdrop: { flex: 1, justifyContent: "flex-end" },
  // ~Half the screen: tall enough for the question to breathe, short enough that
  // the work behind it stays on screen.
  screen: { minHeight: "48%", maxHeight: "90%", backgroundColor: theme.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: space(5), paddingTop: space(3), shadowColor: "#0A0E28", shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: -6 }, elevation: 24 },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.line, marginBottom: space(4) },
  // flexBasis "auto", NOT the flex:1 this used to be. In React Native flex:1
  // means flexBasis:0, so the body contributed nothing to the sheet's intrinsic
  // height: the sheet sized itself from the grabber and the buttons, minHeight
  // fixed it at 48%, and anything taller than that spilled out underneath the
  // actions. A three-line message with a two-line title had its last line drawn
  // under the confirm button. Growing to fill a taller sheet still works, the
  // sheet just measures the content first now.
  body: { flexGrow: 1, flexShrink: 1, flexBasis: "auto", alignItems: "center", justifyContent: "center", paddingVertical: space(4) },
  medallion: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: space(3) },
  title: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 18, lineHeight: 24, letterSpacing: -0.3, color: theme.ink, textAlign: "center" },
  message: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19, color: theme.ink3, textAlign: "center", marginTop: space(2), maxWidth: 320 },
  detail: { alignSelf: "stretch", backgroundColor: theme.bg, borderRadius: radius.md, borderLeftWidth: 3, paddingHorizontal: 16, paddingVertical: 14, marginTop: space(5) },
  detailTxt: { ...type.bodyStrong, color: theme.ink, textAlign: "center" },
  actions: { alignSelf: "stretch", marginTop: space(5) },
  primary: { height: 54, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  primaryTxt: { fontFamily: "Inter_700Bold", fontSize: 16, color: theme.white },
  cancel: { minHeight: 50, alignItems: "center", justifyContent: "center", marginTop: space(1) },
  cancelTxt: { ...type.bodyStrong, color: theme.ink3 },
});
