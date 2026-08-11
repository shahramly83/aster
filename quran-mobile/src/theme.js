// Central design tokens for Nur Quran. Kept intentionally small so screens can
// stay declarative. A single `useColors()` hook flips the palette for dark mode.
import { useColorScheme } from 'react-native';

export const palette = {
  emerald: '#0E5C4A',
  emeraldDark: '#0A4638',
  emeraldLight: '#12866B',
  gold: '#C8A24B',
  goldSoft: '#E4CE93',
};

const light = {
  scheme: 'light',
  bg: '#F6F4EC',
  surface: '#FFFFFF',
  surfaceAlt: '#F0EDE1',
  border: '#E4DECB',
  text: '#1C2A25',
  textMuted: '#6A756F',
  primary: palette.emerald,
  primaryText: '#FFFFFF',
  accent: palette.gold,
  arabic: '#12251E',
  translation: '#43514B',
  danger: '#B23B3B',
  ...palette,
};

const dark = {
  scheme: 'dark',
  bg: '#0B1512',
  surface: '#12211C',
  surfaceAlt: '#182C25',
  border: '#22362E',
  text: '#EDF2EF',
  textMuted: '#93A29B',
  primary: palette.emeraldLight,
  primaryText: '#FFFFFF',
  accent: palette.goldSoft,
  arabic: '#F3EFE2',
  translation: '#BFC7C2',
  danger: '#E27676',
  ...palette,
};

export function useColors() {
  const scheme = useColorScheme();
  return scheme === 'dark' ? dark : light;
}

export const spacing = (n) => n * 4;

export const radius = {
  sm: 8,
  md: 14,
  lg: 22,
  pill: 999,
};

export const font = {
  // System font stack; the reader uses a larger Arabic-friendly size.
  arabicSize: 30,
  arabicLineHeight: 54,
};
