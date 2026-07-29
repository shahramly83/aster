// SlideAction — a drag-the-knob-to-confirm track.
//
// Used where an action is genuinely optional and a full-width primary button
// would overstate it: the hiring manager's own scorecard, which the panel's
// scores do not depend on. A slide asks for deliberate intent without shouting.
//
// A slide is a gesture, and a gesture alone is never the whole control: the
// track is also a plain button, so a tap works, and it carries a button role and
// label so TalkBack/VoiceOver can activate it the ordinary way.
import React, { useRef, useState } from "react";
import { View, Text, Animated, PanResponder, StyleSheet, Platform, Pressable } from "react-native";
import * as Haptics from "expo-haptics";
import { Feather } from "./ui";
import { theme, type, radius, space } from "../theme";

const KNOB = 44;      // ≥44pt: the drag handle is also the tap target
const PAD = 4;        // inset of the knob inside the track
const DONE = 0.82;    // fraction of the travel that counts as committed

export default function SlideAction({ label = "Slide to confirm", doneLabel = "Opening…", icon = "chevron-right", onComplete, style }) {
  const [trackW, setTrackW] = useState(0);
  const [done, setDone] = useState(false);
  const x = useRef(new Animated.Value(0)).current;
  const travel = Math.max(0, trackW - KNOB - PAD * 2);
  // Read inside the responder, which is created once and would otherwise close
  // over the first (zero) measurement.
  const travelRef = useRef(0);
  travelRef.current = travel;
  const doneRef = useRef(false);

  const settle = (to) => Animated.spring(x, { toValue: to, useNativeDriver: true, bounciness: 0, speed: 18 }).start();

  const pan = useRef(
    PanResponder.create({
      // Claim only clearly horizontal drags, so the surrounding ScrollView keeps
      // its vertical gesture.
      onMoveShouldSetPanResponder: (_e, g) => !doneRef.current && Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_e, g) => {
        if (doneRef.current) return;
        x.setValue(Math.min(Math.max(0, g.dx), travelRef.current));
      },
      onPanResponderRelease: (_e, g) => {
        if (doneRef.current) return;
        const t = travelRef.current;
        if (t > 0 && g.dx >= t * DONE) {
          doneRef.current = true;
          setDone(true);
          settle(t);
          if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          onComplete?.();
        } else {
          settle(0);
        }
      },
      onPanResponderTerminate: () => settle(0),
    })
  ).current;

  // Tap fallback: same outcome, no drag. Also what the screen reader activates.
  const complete = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setDone(true);
    settle(travelRef.current);
    onComplete?.();
  };

  const fillShift = Animated.add(x, KNOB + PAD * 2 - trackW);

  return (
    <Pressable
      onPress={complete}
      onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Slide the handle to the right, or activate to open."
      style={[styles.track, style]}
    >
      {trackW > 0 ? <Animated.View style={[styles.fill, { width: trackW, transform: [{ translateX: fillShift }] }]} /> : null}
      <Text style={[type.small, styles.label, done && { color: theme.brand }]} numberOfLines={1}>
        {done ? doneLabel : label}
      </Text>
      <Animated.View {...pan.panHandlers} style={[styles.knob, { transform: [{ translateX: x }] }]}>
        <Feather name={done ? "check" : icon} size={18} color="#fff" />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    height: KNOB + PAD * 2,
    borderRadius: radius.pill,
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.line,
    justifyContent: "center",
    overflow: "hidden",
  },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: theme.brandSoft },
  // (width + translateX are applied inline once the track has been measured)
  label: { textAlign: "center", color: theme.ink3, fontFamily: "Inter_600SemiBold", fontSize: 13, paddingLeft: KNOB / 2 },
  knob: {
    position: "absolute",
    left: PAD,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: theme.brand,
    alignItems: "center",
    justifyContent: "center",
  },
});
