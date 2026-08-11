// One ayah in the reader: Arabic (right-aligned), optional translation, and a
// small action row (play / bookmark). Highlights when it is the ayah currently
// being recited.
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { font, radius, useColors } from '../theme';

function AyahRow({
  ayah,
  showTranslation,
  isActive,
  isBookmarked,
  onPlay,
  onToggleBookmark,
}) {
  const c = useColors();
  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: isActive ? c.surfaceAlt : c.surface,
          borderColor: isActive ? c.accent : c.border,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={[styles.badge, { backgroundColor: c.primary }]}>
          <Text style={[styles.badgeText, { color: c.primaryText }]}>{ayah.numberInSurah}</Text>
        </View>
        <View style={styles.actions}>
          <Pressable hitSlop={10} onPress={onPlay} style={styles.action}>
            <Ionicons
              name={isActive ? 'pause-circle' : 'play-circle'}
              size={26}
              color={c.primary}
            />
          </Pressable>
          <Pressable hitSlop={10} onPress={onToggleBookmark} style={styles.action}>
            <Ionicons
              name={isBookmarked ? 'bookmark' : 'bookmark-outline'}
              size={22}
              color={isBookmarked ? c.accent : c.textMuted}
            />
          </Pressable>
        </View>
      </View>

      <Text style={[styles.arabic, { color: c.arabic }]}>{ayah.arabic}</Text>

      {showTranslation && !!ayah.translation && (
        <Text style={[styles.translation, { color: c.translation }]}>{ayah.translation}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  badge: {
    minWidth: 30,
    height: 24,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  actions: { flexDirection: 'row', alignItems: 'center' },
  action: { marginLeft: 14 },
  arabic: {
    fontSize: font.arabicSize,
    lineHeight: font.arabicLineHeight,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  translation: {
    fontSize: 15,
    lineHeight: 23,
    marginTop: 12,
  },
});

export default React.memo(AyahRow);
