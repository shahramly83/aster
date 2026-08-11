// Persistent playback bar shown above the tab bar whenever something is loaded.
// Reflects the PlayerContext and offers prev / play-pause / next / close.
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { usePlayer } from '../context/PlayerContext';
import { radius, useColors } from '../theme';

export default function MiniPlayer() {
  const c = useColors();
  const { current, isPlaying, isLoading, togglePlay, next, prev, stop } = usePlayer();

  if (!current) return null;

  return (
    <View style={[styles.bar, { backgroundColor: c.primary }]}>
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {current.surahName ? `${current.surahName} · ` : ''}Ayat {current.numberInSurah}
        </Text>
        {!!current.translation && (
          <Text style={styles.sub} numberOfLines={1}>
            {current.translation}
          </Text>
        )}
      </View>
      <View style={styles.controls}>
        <Pressable hitSlop={8} onPress={prev} style={styles.ctrl}>
          <Ionicons name="play-skip-back" size={20} color="#fff" />
        </Pressable>
        <Pressable hitSlop={8} onPress={togglePlay} style={styles.ctrl}>
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={24} color="#fff" />
          )}
        </Pressable>
        <Pressable hitSlop={8} onPress={next} style={styles.ctrl}>
          <Ionicons name="play-skip-forward" size={20} color="#fff" />
        </Pressable>
        <Pressable hitSlop={8} onPress={stop} style={styles.ctrl}>
          <Ionicons name="close" size={20} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    marginHorizontal: 10,
    marginBottom: 6,
  },
  info: { flex: 1, marginRight: 10 },
  title: { color: '#fff', fontSize: 14, fontWeight: '700' },
  sub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 },
  controls: { flexDirection: 'row', alignItems: 'center' },
  ctrl: { marginLeft: 12 },
});
