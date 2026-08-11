// A single row in the surah list: number medallion, transliteration + meaning,
// Arabic name, and revelation/ayah-count meta.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, useColors } from '../theme';

function SurahCard({ surah, onPress }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View style={[styles.medallion, { borderColor: c.accent }]}>
        <Text style={[styles.medallionText, { color: c.primary }]}>{surah.number}</Text>
      </View>
      <View style={styles.mid}>
        <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
          {surah.englishName}
        </Text>
        <Text style={[styles.meta, { color: c.textMuted }]} numberOfLines={1}>
          {surah.englishNameTranslation} · {surah.revelationType} · {surah.numberOfAyahs} ayat
        </Text>
      </View>
      <Text style={[styles.arabic, { color: c.arabic }]}>{surah.name}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  medallion: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medallionText: { fontSize: 14, fontWeight: '700' },
  mid: { flex: 1, marginHorizontal: 12 },
  name: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 12, marginTop: 2 },
  arabic: { fontSize: 22, fontWeight: '600' },
});

export default React.memo(SurahCard);
