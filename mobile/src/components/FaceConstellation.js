import React, { useEffect, useRef } from "react";
import { View, Image, StyleSheet, Animated, Easing, useWindowDimensions, AccessibilityInfo } from "react-native";

// Nine people on concentric orbits: the product is a hiring network, so the
// sign-in leads with people rather than a logo. Positions are fractions of the
// art box, not fixed points, so the same arrangement holds from a 360dp phone to
// a tablet without a second layout.
const FACES = [
  require("../../assets/faces/face-1.jpg"),
  require("../../assets/faces/face-2.jpg"),
  require("../../assets/faces/face-3.jpg"),
  require("../../assets/faces/face-4.jpg"),
  require("../../assets/faces/face-5.jpg"),
  require("../../assets/faces/face-6.jpg"),
  require("../../assets/faces/face-7.jpg"),
  require("../../assets/faces/face-8.jpg"),
  require("../../assets/faces/face-9.jpg"),
];

// index into FACES, x, y, diameter. x/d are fractions of the box WIDTH so circles
// stay round; y is a fraction of its HEIGHT.
const LAYOUT = [
  { i: 0, x: 0.350, y: 0.495, d: 0.295 },   // hero, off-centre so the ring shows
  { i: 1, x: 0.240, y: 0.160, d: 0.185 },
  { i: 2, x: 0.520, y: 0.065, d: 0.135 },
  { i: 3, x: 0.780, y: 0.200, d: 0.185 },
  { i: 4, x: 0.085, y: 0.330, d: 0.135 },
  { i: 5, x: 0.560, y: 0.260, d: 0.125 },
  { i: 6, x: 0.840, y: 0.460, d: 0.155 },
  { i: 7, x: 0.670, y: 0.705, d: 0.150 },
  { i: 8, x: 0.145, y: 0.715, d: 0.120 },
];

const BRAND = "#0B2AE0";
const PERI = "#93A7FF";
const RING_DEFAULT = "rgba(255,255,255,0.9)";

// `a` is the strong dot, `b` the soft one. Which actual colours those are comes
// from the skin: on a blue ground a brand-blue dot is invisible.
const DOTS = [
  { x: 0.455, y: 0.185, d: 0.032, t: "a" },
  { x: 0.900, y: 0.095, d: 0.022, t: "a" },
  { x: 0.035, y: 0.500, d: 0.028, t: "b" },
  { x: 0.420, y: 0.875, d: 0.052, t: "a" },
  { x: 0.885, y: 0.815, d: 0.040, t: "b" },
  { x: 0.630, y: 0.415, d: 0.016, t: "a" },
];

const RING_RADII = [0.28, 0.43, 0.59, 0.76];   // fractions of box width
const RING_CX = 0.47;
const RING_CY = 0.46;

// Each face scales up from 0.6 in turn, 45ms apart, so the group assembles
// instead of appearing. Anything faster reads as a flicker, anything slower
// delays the person who just wants to type.
function Face({ source, size, left, top, delay, still }) {
  const v = useRef(new Animated.Value(still ? 1 : 0)).current;
  useEffect(() => {
    if (still) { v.setValue(1); return; }
    Animated.timing(v, {
      toValue: 1, duration: 460, delay, easing: Easing.out(Easing.back(1.3)), useNativeDriver: true,
    }).start();
  }, [v, delay, still]);

  return (
    <Animated.View
      style={[
        styles.chip,
        {
          width: size, height: size, borderRadius: size / 2, left, top,
          opacity: v,
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
        },
      ]}
    >
      {/* Android antialiases a rounded Image poorly on its own, so the ring is a
          separate clipping View and the image inside is left square. Without
          this the circle edge comes out visibly stepped. */}
      <View style={{ width: size - 6, height: size - 6, borderRadius: (size - 6) / 2, overflow: "hidden" }}>
        <Image source={source} style={{ width: size - 6, height: size - 6 }} resizeMode="cover" fadeDuration={0} />
      </View>
    </Animated.View>
  );
}

export default function FaceConstellation({ height, style, ring = RING_DEFAULT, dotA = BRAND, dotB = PERI }) {
  const { width } = useWindowDimensions();
  const [still, setStill] = React.useState(false);

  // Someone who has asked the OS to reduce motion gets the finished arrangement,
  // not nine things springing in.
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => { if (alive && on) setStill(true); });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => setStill(!!on));
    return () => { alive = false; sub?.remove?.(); };
  }, []);

  // The rings turn once every four minutes. You never catch it moving, but the
  // screen is never quite static either.
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 240000, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [spin, still]);

  const px = (f) => f * width;

  return (
    // Decorative: a screen reader announcing nine unlabelled images before the
    // email field would be worse than silence.
    <View
      style={[{ height, width: "100%" }, style]}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] },
        ]}
      >
        {RING_RADII.map((r) => {
          const size = px(r) * 2;
          return (
            <View
              key={r}
              style={{
                position: "absolute",
                width: size, height: size, borderRadius: size / 2,
                // Two physical pixels: 0.57dp on this screen. One pixel was a touch
                // too faint to hold the arrangement together, 1dp read as a drawn
                // stroke competing with the faces. Expressed in hairlines so it
                // stays two pixels on any density rather than becoming a fat line
                // on a 2x screen.
                borderWidth: StyleSheet.hairlineWidth * 2, borderColor: ring,
                left: px(RING_CX) - size / 2,
                top: height * RING_CY - size / 2,
              }}
            />
          );
        })}
      </Animated.View>

      {DOTS.map((d, n) => {
        const size = px(d.d);
        return (
          <View
            key={n}
            style={{
              position: "absolute", width: size, height: size, borderRadius: size / 2,
              backgroundColor: d.t === "a" ? dotA : dotB, left: px(d.x) - size / 2, top: height * d.y - size / 2,
            }}
          />
        );
      })}

      {LAYOUT.map((f, n) => {
        const size = px(f.d);
        return (
          <Face
            key={f.i}
            source={FACES[f.i]}
            size={size}
            left={px(f.x) - size / 2}
            top={height * f.y - size / 2}
            delay={n * 45}
            still={still}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // A white rim and a low shadow lift each face off the page, which is what stops
  // the group reading as a flat collage.
  chip: {
    position: "absolute",
    padding: 3,
    backgroundColor: "#FFFFFF",
    shadowColor: "#1B2559",
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
});
