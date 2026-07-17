// Small styled primitives shared across screens. Deliberately lightweight — no
// component library, just the Aster tokens applied consistently.
import React from "react";
import { View, Text, Pressable, ActivityIndicator, Image, StyleSheet } from "react-native";
import { theme, radius } from "../theme";
import { stageColor, stageLabel } from "@aster/shared";

export function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({ title, onPress, variant = "primary", disabled, style }) {
  const isPrimary = variant === "primary";
  const isGhost = variant === "ghost";
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.btn,
        isPrimary && styles.btnPrimary,
        isGhost && styles.btnGhost,
        variant === "danger" && styles.btnDanger,
        disabled && styles.btnDisabled,
        pressed && !disabled && { opacity: 0.85 },
        style,
      ]}
    >
      <Text style={[styles.btnText, (isGhost) && { color: theme.brand }]}>{title}</Text>
    </Pressable>
  );
}

export function Avatar({ uri, name, size = 44 }) {
  const initials = (name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.brandSoft, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: theme.brand, fontWeight: "700", fontSize: size * 0.36 }}>{initials}</Text>
    </View>
  );
}

export function StagePill({ stage }) {
  const color = stageColor(stage);
  return (
    <View style={[styles.pill, { backgroundColor: color + "22" }]}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, marginRight: 6 }} />
      <Text style={{ color: theme.ink2, fontSize: 12, fontWeight: "600" }}>{stageLabel(stage)}</Text>
    </View>
  );
}

// Compact circular AI match score, e.g. 82. null → dash.
export function ScoreRing({ score, size = 40 }) {
  const val = typeof score === "number" ? Math.round(score) : null;
  const color = val == null ? theme.ink3 : val >= 75 ? theme.success : val >= 50 ? theme.warn : theme.ink3;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 3, borderColor: color, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: theme.ink, fontWeight: "700", fontSize: 13 }}>{val == null ? "–" : val}</Text>
    </View>
  );
}

export function Loader({ label }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={theme.brand} />
      {label ? <Text style={{ color: theme.ink3, marginTop: 10 }}>{label}</Text> : null}
    </View>
  );
}

export function EmptyState({ title, subtitle }) {
  return (
    <View style={styles.centered}>
      <Text style={{ color: theme.ink, fontWeight: "700", fontSize: 16 }}>{title}</Text>
      {subtitle ? <Text style={{ color: theme.ink3, marginTop: 6, textAlign: "center", paddingHorizontal: 24 }}>{subtitle}</Text> : null}
    </View>
  );
}

export function ScreenTitle({ children, subtitle }) {
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 }}>
      <Text style={{ color: theme.ink, fontWeight: "800", fontSize: 26 }}>{children}</Text>
      {subtitle ? <Text style={{ color: theme.ink3, marginTop: 2 }}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.line,
    padding: 16,
  },
  btn: { paddingVertical: 13, paddingHorizontal: 18, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  btnPrimary: { backgroundColor: theme.brand },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.line },
  btnDanger: { backgroundColor: theme.danger },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  pill: { flexDirection: "row", alignItems: "center", paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.pill, alignSelf: "flex-start" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
});
