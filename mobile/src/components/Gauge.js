// Data-viz primitives for the analytics dashboard: a circular arc gauge and a
// segmented meter bar, built on react-native-svg. Styled for the dark premium
// look of the reference concept.
import React from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Path, Circle } from "react-native-svg";

const TAU = Math.PI * 2;

// Point on a circle where 0deg = top and angle increases clockwise.
function polar(cx, cy, r, deg) {
  const a = (deg / 360) * TAU;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}
// SVG arc path from startDeg to endDeg, drawn clockwise (sweep = 1).
function arcPath(cx, cy, r, startDeg, endDeg) {
  const [sx, sy] = polar(cx, cy, r, startDeg);
  const [ex, ey] = polar(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`;
}

// A 270deg gauge (gap at the bottom): grey track + a coloured progress arc.
// `pct` 0..100. No inner label — the big number lives beside it, as in the ref.
export function RingGauge({ pct = 0, size = 76, stroke = 9, color = "#0B2AE0", track = "#2A2C33" }) {
  const r = (size - stroke) / 2;
  const cx = size / 2, cy = size / 2;
  const START = 225, SWEEP = 270; // gap of 90deg centred at the bottom
  const p = Math.max(0, Math.min(100, pct));
  const end = START + (SWEEP * p) / 100;
  return (
    <Svg width={size} height={size}>
      <Path d={arcPath(cx, cy, r, START, START + SWEEP)} stroke={track} strokeWidth={stroke} strokeLinecap="round" fill="none" />
      {p > 0 ? <Path d={arcPath(cx, cy, r, START, end)} stroke={color} strokeWidth={stroke} strokeLinecap="round" fill="none" /> : null}
    </Svg>
  );
}

// A full-circle progress ring (used where a closed ring reads better).
export function RingFull({ pct = 0, size = 64, stroke = 8, color = "#0B2AE0", track = "#2A2C33" }) {
  const r = (size - stroke) / 2;
  const c = size / 2;
  const C = TAU * r;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <Svg width={size} height={size}>
      <Circle cx={c} cy={c} r={r} stroke={track} strokeWidth={stroke} fill="none" />
      <Circle
        cx={c} cy={c} r={r} stroke={color} strokeWidth={stroke} fill="none"
        strokeLinecap="round" strokeDasharray={`${(C * p) / 100} ${C}`}
        transform={`rotate(-90 ${c} ${c})`}
      />
    </Svg>
  );
}

// Segmented meter bar (the "risk score" bar): N ticks, the first `pct%` filled
// with `color`, the rest muted. Reads as a precise, technical gauge.
export function MeterBar({ pct = 0, color = "#0B2AE0", track = "#2A2C33", ticks = 40, height = 26 }) {
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * ticks);
  return (
    <View style={[styles.meter, { height }]}>
      {Array.from({ length: ticks }).map((_, i) => (
        <View key={i} style={{ flex: 1, height: "100%", borderRadius: 2, backgroundColor: i < filled ? color : track }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  meter: { flexDirection: "row", alignItems: "stretch", gap: 3 },
});
