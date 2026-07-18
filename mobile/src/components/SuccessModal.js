// Branded success confirmation: a green check springs in over a centered card.
// Replaces the OS Alert for "saved / submitted / sent" moments so the app keeps
// its own look. Single Done action calls onClose.
import React, { useEffect, useRef } from "react";
import { Modal, View, Text, Pressable, Animated, StyleSheet } from "react-native";
import { Feather } from "./ui";
import { theme, type, space, radius } from "../theme";

export default function SuccessModal({ visible, title, message, confirmLabel = "Done", onClose }) {
  const scale = useRef(new Animated.Value(0.7)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const check = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    scale.setValue(0.7); opacity.setValue(0); check.setValue(0);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 8, bounciness: 9 }),
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
    Animated.sequence([
      Animated.delay(120),
      Animated.spring(check, { toValue: 1, useNativeDriver: true, speed: 6, bounciness: 13 }),
    ]).start();
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Animated.View style={[styles.card, { opacity, transform: [{ scale }] }]}>
          <Animated.View style={[styles.ring, { transform: [{ scale: check }] }]}>
            <Feather name="check" size={34} color={theme.white} />
          </Animated.View>
          <Text style={[type.h3, { color: theme.ink, textAlign: "center", marginTop: space(4) }]}>{title}</Text>
          {message ? <Text style={[type.small, { color: theme.ink3, textAlign: "center", marginTop: 8, lineHeight: 20 }]}>{message}</Text> : null}
          <Pressable onPress={onClose} style={styles.btn}>
            <Text style={[type.smallStrong, { color: theme.white }]}>{confirmLabel}</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(10,14,40,0.5)", alignItems: "center", justifyContent: "center", padding: space(6) },
  card: { width: "100%", maxWidth: 340, backgroundColor: theme.card, borderRadius: 24, paddingHorizontal: space(6), paddingVertical: space(7), alignItems: "center", ...(theme.shadowLg || {}) },
  ring: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.success, alignItems: "center", justifyContent: "center" },
  btn: { alignSelf: "stretch", height: 50, borderRadius: radius.md, backgroundColor: theme.brand, alignItems: "center", justifyContent: "center", marginTop: space(6) },
});
