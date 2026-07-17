// Aster mobile design tokens.
// Built on the Aster blue brand (#0B2AE0) with a full tonal scale, an Inter type
// scale, a consistent elevation system and a 4pt spacing rhythm. Everything the
// UI renders reads from here so the app feels like one cohesive product.

export const palette = {
  // Brand blue, tonal scale (50 -> 900)
  brand50: "#EEF1FE",
  brand100: "#E0E6FE",
  brand200: "#C4CEFC",
  brand300: "#9AAAF9",
  brand400: "#5570F5",
  brand500: "#2B4BF0",
  brand: "#0B2AE0", // primary
  brand700: "#0A22B4",
  brand800: "#0B1E92",
  brand900: "#0D1E76",

  // Neutral ink scale
  ink: "#0F1222", // headings
  ink2: "#3D4155", // body
  ink3: "#6B7185", // muted
  ink4: "#9CA1B3", // faint / placeholder

  // Surfaces
  bg: "#F7F8FC", // app background
  bgElevated: "#FFFFFF",
  card: "#FFFFFF",
  line: "#E9EBF2", // hairline borders
  line2: "#F0F2F7", // subtle fills

  // Semantic
  success: "#12A150",
  successBg: "#E7F7EE",
  warn: "#E8890C",
  warnBg: "#FDF1E3",
  danger: "#E5484D",
  dangerBg: "#FDECEC",
  info: "#0B2AE0",

  white: "#FFFFFF",
};

// Semantic aliases used across the app.
export const theme = {
  brand: palette.brand,
  brandSoft: palette.brand50,
  brandSoft2: palette.brand100,
  onBrand: palette.white,
  ink: palette.ink,
  ink2: palette.ink2,
  ink3: palette.ink3,
  ink4: palette.ink4,
  bg: palette.bg,
  card: palette.card,
  line: palette.line,
  line2: palette.line2,
  success: palette.success,
  successBg: palette.successBg,
  warn: palette.warn,
  warnBg: palette.warnBg,
  danger: palette.danger,
  dangerBg: palette.dangerBg,
  white: palette.white,
};

export const radius = { xs: 8, sm: 10, md: 14, lg: 18, xl: 24, pill: 999 };

// 4pt spacing rhythm.
export const space = (n) => n * 4;

// Inter type scale. `family` values are the loaded font names (see App.js).
export const type = {
  display: { fontFamily: "Inter_700Bold", fontSize: 30, lineHeight: 36, letterSpacing: -0.5 },
  h1: { fontFamily: "Inter_700Bold", fontSize: 24, lineHeight: 30, letterSpacing: -0.3 },
  h2: { fontFamily: "Inter_600SemiBold", fontSize: 19, lineHeight: 25, letterSpacing: -0.2 },
  h3: { fontFamily: "Inter_600SemiBold", fontSize: 16, lineHeight: 22 },
  bodyStrong: { fontFamily: "Inter_600SemiBold", fontSize: 15, lineHeight: 21 },
  body: { fontFamily: "Inter_400Regular", fontSize: 15, lineHeight: 22 },
  small: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18 },
  smallStrong: { fontFamily: "Inter_600SemiBold", fontSize: 13, lineHeight: 18 },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 11, lineHeight: 14, letterSpacing: 0.6 },
  tabular: { fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
};

// Elevation presets (iOS shadow + Android elevation). Consistent, not random.
export const shadow = {
  sm: {
    shadowColor: "#0B1B4D",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  md: {
    shadowColor: "#0B1B4D",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  brand: {
    shadowColor: palette.brand,
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
};
