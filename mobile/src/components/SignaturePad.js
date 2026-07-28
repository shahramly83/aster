// Draw-your-signature pad, and a pure-JS PNG encoder to go with it.
//
// The offer PDF embeds a drawn signature with pdf-lib's embedPng/embedJpg
// (aster-sign), so the pad MUST produce a PNG data URI. The usual way to get one
// from a React Native view is react-native-view-shot, which is not part of Expo
// Go, so there would be no way to test this on a device without a dev build.
//
// Instead the strokes are rasterised into a pixel buffer here and encoded as a
// PNG by hand. That needs no native module, so it runs anywhere the app does.
// The encoder uses zlib STORED (uncompressed) blocks: legal deflate, a few lines
// of code, no compressor. The cost is file size, so the image is cropped to the
// ink before encoding, which keeps a normal signature well under ~150 KB.
import React, { useCallback, useMemo, useRef, useState } from "react";
import { View, Text, PanResponder, StyleSheet } from "react-native";
import Svg, { Path } from "react-native-svg";
import { theme, type, space, radius } from "../theme";

// ---------------------------------------------------------------------------
// PNG encoding
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function adler32(bytes) {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}
function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
// Everything below appends into a Uint8Array rather than spreading arrays into
// literals. A signature is ~100 KB of bytes, and `[...bigArray]` at that size
// blows the JS call stack ("Maximum call stack size exceeded"), which is a crash
// at exactly the moment someone hits Save.
function concatBytes(parts) {
  let n = 0;
  for (const part of parts) n += part.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}
function chunk(type, data) {
  const head = new Uint8Array(type.length);
  for (let i = 0; i < type.length; i++) head[i] = type.charCodeAt(i);
  const body = concatBytes([head, data instanceof Uint8Array ? data : Uint8Array.from(data)]);
  return concatBytes([Uint8Array.from(u32(data.length)), body, Uint8Array.from(u32(crc32(body)))]);
}
// zlib stream made of stored blocks: 0x78 0x01, then [final, len, ~len, bytes]*,
// then adler32 of the raw data.
function zlibStored(raw) {
  const MAX = 65535;
  const blocks = Math.ceil(raw.length / MAX) || 1;
  const out = new Uint8Array(2 + blocks * 5 + raw.length + 4);
  let p = 0;
  out[p++] = 0x78; out[p++] = 0x01;
  for (let i = 0; i < raw.length; i += MAX) {
    const part = raw.subarray(i, Math.min(i + MAX, raw.length));
    out[p++] = i + MAX >= raw.length ? 1 : 0;
    out[p++] = part.length & 255;
    out[p++] = (part.length >>> 8) & 255;
    out[p++] = ~part.length & 255;
    out[p++] = (~part.length >>> 8) & 255;
    out.set(part, p); p += part.length;
  }
  out.set(Uint8Array.from(u32(adler32(raw))), p);
  return out;
}
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function toBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
    out += b1 === undefined ? "=" : B64[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
    out += b2 === undefined ? "=" : B64[b2 & 63];
  }
  return out;
}
// Grayscale + alpha (colour type 4): the ink is black and everything else is
// transparent, so the signature stamps onto the letter without a white box over
// the text underneath.
function encodePngGrayAlpha(gray, alpha, w, h) {
  const raw = new Uint8Array(h * (1 + w * 2));
  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < w; x++) { const i = y * w + x; raw[p++] = gray[i]; raw[p++] = alpha[i]; }
  }
  const ihdr = Uint8Array.from([...u32(w), ...u32(h), 8, 4, 0, 0, 0]);
  const bytes = concatBytes([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibStored(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
  return "data:image/png;base64," + toBase64(bytes);
}

// ---------------------------------------------------------------------------
// Rasterising the strokes
// ---------------------------------------------------------------------------
// Stamps a filled disc, so a stroke keeps a constant weight and rounded ends
// rather than the hairline a naive line plot gives.
function disc(alpha, w, h, cx, cy, r) {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r + 0.5) continue;
      // Feather the last half pixel so the edge is not a staircase.
      const a = d <= r - 0.5 ? 255 : Math.round(255 * (r + 0.5 - d));
      const i = y * w + x;
      if (a > alpha[i]) alpha[i] = a;
    }
  }
}
function strokesToPng(strokes, padW, padH) {
  const pts = strokes.flat();
  if (!pts.length) return null;
  // Crop to the ink. Encoding the whole pad would be mostly transparent pixels,
  // and stored deflate cannot compress them away.
  const PAD = 8;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  minX = Math.max(0, minX - PAD); minY = Math.max(0, minY - PAD);
  maxX = Math.min(padW, maxX + PAD); maxY = Math.min(padH, maxY + PAD);
  const w = Math.max(1, Math.round(maxX - minX));
  const h = Math.max(1, Math.round(maxY - minY));
  const gray = new Uint8Array(w * h);   // 0 = black ink everywhere
  const alpha = new Uint8Array(w * h);  // 0 = transparent
  const R = 1.6;
  for (const stroke of strokes) {
    if (stroke.length === 1) { disc(alpha, w, h, stroke[0].x - minX, stroke[0].y - minY, R); continue; }
    for (let i = 1; i < stroke.length; i++) {
      const a = stroke[i - 1], b = stroke[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
      for (let s = 0; s <= steps; s++) {
        disc(alpha, w, h, a.x + (dx * s) / steps - minX, a.y + (dy * s) / steps - minY, R);
      }
    }
  }
  return encodePngGrayAlpha(gray, alpha, w, h);
}

// ---------------------------------------------------------------------------
// The pad
// ---------------------------------------------------------------------------
export default function SignaturePad({ height = 170, onChange }) {
  const [strokes, setStrokes] = useState([]);   // committed strokes
  const [live, setLive] = useState([]);         // the stroke under the finger
  const size = useRef({ w: 0, h: 0 });
  const liveRef = useRef([]);
  const strokesRef = useRef([]);

  const commit = useCallback((all) => {
    strokesRef.current = all;
    setStrokes(all);
    onChange?.(all.length ? () => strokesToPng(all, size.current.w, size.current.h) : null);
  }, [onChange]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    // The pad sits inside a scroll view; claiming the gesture stops a signature
    // stroke from scrolling the sheet instead of drawing.
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (e) => {
      liveRef.current = [{ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }];
      setLive(liveRef.current);
    },
    onPanResponderMove: (e) => {
      liveRef.current = [...liveRef.current, { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }];
      setLive(liveRef.current);
    },
    onPanResponderRelease: () => {
      const all = [...strokesRef.current, liveRef.current];
      liveRef.current = []; setLive([]);
      commit(all);
    },
  }), [commit]);

  const clear = () => { liveRef.current = []; setLive([]); commit([]); };
  const toPath = (s) => s.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const empty = !strokes.length && !live.length;

  return (
    <View>
      <View
        style={[styles.pad, { height }]}
        onLayout={(e) => { size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }; }}
        {...pan.panHandlers}
      >
        <Svg width="100%" height="100%">
          {strokes.map((s, i) => (
            <Path key={i} d={toPath(s)} stroke={theme.ink} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          ))}
          {live.length ? (
            <Path d={toPath(live)} stroke={theme.ink} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          ) : null}
        </Svg>
        {empty ? (
          <View style={styles.hint} pointerEvents="none">
            <Text style={[type.small, { color: theme.ink4 }]}>Sign here</Text>
          </View>
        ) : null}
        <View style={styles.baseline} pointerEvents="none" />
      </View>
      <View style={styles.padFoot}>
        <Text style={[type.small, { color: theme.ink4, flex: 1 }]}>Use your finger to sign.</Text>
        <Text
          onPress={empty ? undefined : clear}
          suppressHighlighting
          style={[type.smallStrong, { color: empty ? theme.ink4 : theme.brand }]}
          accessibilityRole="button"
          accessibilityState={{ disabled: empty }}
        >
          Clear
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    backgroundColor: theme.bg, borderRadius: radius.md,
    borderWidth: 1, borderColor: theme.line, overflow: "hidden",
  },
  // A ruled line to sign on, inset so strokes are not clipped by the border.
  baseline: { position: "absolute", left: 22, right: 22, bottom: 34, height: 1, backgroundColor: theme.line },
  hint: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  padFoot: { flexDirection: "row", alignItems: "center", marginTop: space(2) },
});
