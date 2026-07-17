// Branded launch animation. Shown over an Aster-blue field: the mark scales and
// fades in, the wordmark follows, then the whole thing fades out into the app.
// Gives the app a premium, on-brand first impression beyond the OS splash.
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View, Easing } from "react-native";
import { AsterMark } from "./Logo";
import { theme } from "../theme";

export default function BrandSplash({ onDone }) {
  const markScale = useRef(new Animated.Value(0.7)).current;
  const markOpacity = useRef(new Animated.Value(0)).current;
  const wordOpacity = useRef(new Animated.Value(0)).current;
  const wordShift = useRef(new Animated.Value(8)).current;
  const wrapOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(markScale, { toValue: 1, useNativeDriver: true, speed: 6, bounciness: 8 }),
        Animated.timing(markOpacity, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(wordOpacity, { toValue: 1, duration: 340, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(wordShift, { toValue: 0, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.delay(360),
      Animated.timing(wrapOpacity, { toValue: 0, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(({ finished }) => finished && onDone?.());
  }, []);

  return (
    <Animated.View style={[styles.fill, { opacity: wrapOpacity }]}>
      <Animated.View style={{ opacity: markOpacity, transform: [{ scale: markScale }] }}>
        <AsterMark size={84} color={theme.white} />
      </Animated.View>
      <Animated.View style={{ opacity: wordOpacity, transform: [{ translateY: wordShift }], marginTop: 20 }}>
        <View style={styles.word}>
          {"ASTER".split("").map((ch, i) => (
            <Animated.Text key={i} style={styles.letter}>{ch}</Animated.Text>
          ))}
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.brand, alignItems: "center", justifyContent: "center", zIndex: 100 },
  word: { flexDirection: "row" },
  letter: { color: theme.white, fontFamily: "Inter_700Bold", fontSize: 30, letterSpacing: 6, marginHorizontal: 1 },
});
