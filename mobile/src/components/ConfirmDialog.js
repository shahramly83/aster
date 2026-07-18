// A branded confirmation dialog to replace the plain native Alert. Centered
// card, accent icon, and Cancel / Confirm actions coloured by intent.
import React from "react";
import { View, Text, Modal, StyleSheet } from "react-native";
import { Button, Feather } from "./ui";
import { theme, type, space, radius } from "../theme";

export default function ConfirmDialog({
  visible, title, message, icon,
  confirmLabel = "Confirm", cancelLabel = "Cancel",
  variant = "primary", // primary | danger | success
  onConfirm, onCancel,
}) {
  const accent = variant === "danger" ? theme.danger : variant === "success" ? theme.success : theme.brand;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {icon ? (
            <View style={[styles.icon, { backgroundColor: accent + "18" }]}>
              <Feather name={icon} size={24} color={accent} />
            </View>
          ) : null}
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={styles.row}>
            <Button title={cancelLabel} variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
            <Button title={confirmLabel} variant={variant} onPress={onConfirm} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(10,14,40,0.55)", alignItems: "center", justifyContent: "center", padding: space(6) },
  card: { width: "100%", maxWidth: 380, backgroundColor: theme.card, borderRadius: 24, padding: space(5), alignItems: "center" },
  icon: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: space(4) },
  title: { fontFamily: "Inter_700Bold", fontSize: 20, letterSpacing: -0.3, color: theme.ink, textAlign: "center" },
  message: { fontFamily: "Inter_400Regular", fontSize: 15, lineHeight: 22, color: theme.ink3, textAlign: "center", marginTop: space(2) },
  row: { flexDirection: "row", gap: 10, marginTop: space(5), alignSelf: "stretch" },
});
