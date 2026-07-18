// Branded launch animation over an Aster-blue gradient: the starburst mark spins
// and scales into place, holds, then fades out into the app. Clean mark, no
// wordmark or backing shape. Premium, on-brand first impression beyond the OS
// splash.
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Easing } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { AsterMark } from "./Logo";
import { theme } from "../theme";

export default function BrandSplash({ onDone }) {
  const markScale = useRef(new Animated.Value(0.6)).current;
  const markOpacity = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current; // -120deg -> 0 spin-in
  const wrapOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(markScale, { toValue: 1, useNativeDriver: true, speed: 5, bounciness: 7 }),
        Animated.timing(markOpacity, { toValue: 1, duration: 500, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.delay(560),
      Animated.timing(wrapOpacity, { toValue: 0, duration: 340, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(({ finished }) => finished && onDone?.());
  }, []);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["-120deg", "0deg"] });

  return (
    <Animated.View style={[styles.fill, { opacity: wrapOpacity }]}>
      <LinearGradient colors={["#1A48FF", "#0B2AE0", "#081C93"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Animated.View style={{ opacity: markOpacity, transform: [{ scale: markScale }, { rotate }] }}>
        <AsterMark size={104} color={theme.white} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", zIndex: 100 },
});
