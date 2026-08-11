// Landing screen: greeting + Hijri date, "continue reading" resume card, a
// verse-of-the-hour highlight, and quick links into the main features.
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Screen from '../components/Screen';
import { useSettings } from '../context/SettingsContext';
import { fetchAyah } from '../lib/api';
import { getLastRead } from '../lib/storage';
import { palette, radius, useColors } from '../theme';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Selamat malam';
  if (h < 12) return 'Selamat pagi';
  if (h < 18) return 'Selamat petang';
  return 'Selamat malam';
}

export default function HomeScreen({ navigation }) {
  const c = useColors();
  const { settings } = useSettings();
  const [lastRead, setLastRead] = useState(null);
  const [verse, setVerse] = useState(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getLastRead().then((lr) => alive && setLastRead(lr));
      // Deterministic "verse of the hour": pick by day+hour so it is stable
      // for an hour and matches the notification cadence.
      const seed = (new Date().getFullYear() * 366 + dayOfYear() * 24 + new Date().getHours()) % 6236;
      fetchAyah(seed + 1, settings.translation, settings.reciter)
        .then((a) => alive && setVerse(a))
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [settings.translation, settings.reciter])
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <LinearGradient
          colors={[palette.emerald, palette.emeraldDark]}
          style={styles.hero}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <Text style={styles.heroKicker}>{greeting()}</Text>
          <Text style={styles.heroTitle}>Nur Quran</Text>
          <Text style={styles.heroSub}>Baca, dengar, dan renungi Al-Quran</Text>
        </LinearGradient>

        {lastRead ? (
          <Pressable
            onPress={() =>
              navigation.navigate('QuranTab', {
                screen: 'Reader',
                params: { surah: lastRead.surah, name: lastRead.name, scrollToAyah: lastRead.ayah },
                initial: false,
              })
            }
            style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
          >
            <View style={styles.cardRow}>
              <Ionicons name="book" size={20} color={c.primary} />
              <Text style={[styles.cardLabel, { color: c.textMuted }]}>Sambung membaca</Text>
            </View>
            <Text style={[styles.cardTitle, { color: c.text }]}>
              {lastRead.name} · Ayat {lastRead.ayah}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => navigation.navigate('QuranTab')}
            style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
          >
            <View style={styles.cardRow}>
              <Ionicons name="book-outline" size={20} color={c.primary} />
              <Text style={[styles.cardLabel, { color: c.textMuted }]}>Mula membaca</Text>
            </View>
            <Text style={[styles.cardTitle, { color: c.text }]}>Al-Fatihah</Text>
          </Pressable>
        )}

        {verse && (
          <View style={[styles.verseCard, { backgroundColor: c.surface, borderColor: c.accent }]}>
            <Text style={[styles.verseKicker, { color: c.accent }]}>Ayat pilihan</Text>
            <Text style={[styles.verseArabic, { color: c.arabic }]}>{verse.arabic}</Text>
            {!!verse.translation && (
              <Text style={[styles.verseTrans, { color: c.translation }]}>{verse.translation}</Text>
            )}
            <Text style={[styles.verseRef, { color: c.textMuted }]}>
              {verse.surah.englishName} : {verse.numberInSurah}
            </Text>
          </View>
        )}

        <View style={styles.grid}>
          <QuickLink icon="list" label="Surah" color={c} onPress={() => navigation.navigate('QuranTab')} />
          <QuickLink
            icon="bookmark"
            label="Penanda"
            color={c}
            onPress={() => navigation.navigate('BookmarksTab')}
          />
          <QuickLink
            icon="time"
            label="Waktu Solat"
            color={c}
            onPress={() => navigation.navigate('PrayerTab')}
          />
          <QuickLink
            icon="settings"
            label="Tetapan"
            color={c}
            onPress={() => navigation.navigate('SettingsTab')}
          />
        </View>

        {!settings.hourlyVerse && (
          <Pressable
            onPress={() => navigation.navigate('SettingsTab')}
            style={[styles.nudge, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}
          >
            <Ionicons name="notifications-outline" size={18} color={c.primary} />
            <Text style={[styles.nudgeText, { color: c.text }]}>
              Hidupkan ayat setiap jam (Bahasa Melayu) di Tetapan
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </Screen>
  );
}

function QuickLink({ icon, label, onPress, color: c }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.quick, { backgroundColor: c.surface, borderColor: c.border }]}
    >
      <Ionicons name={icon} size={24} color={c.primary} />
      <Text style={[styles.quickLabel, { color: c.text }]}>{label}</Text>
    </Pressable>
  );
}

function dayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now - start) / 86400000);
}

const styles = StyleSheet.create({
  content: { padding: 14, paddingBottom: 28 },
  hero: {
    borderRadius: radius.lg,
    padding: 22,
    marginBottom: 14,
  },
  heroKicker: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '600' },
  heroTitle: { color: '#fff', fontSize: 30, fontWeight: '800', marginTop: 4 },
  heroSub: { color: 'rgba(255,255,255,0.9)', fontSize: 14, marginTop: 6 },
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginBottom: 12,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  cardLabel: { fontSize: 13, fontWeight: '600', marginLeft: 8 },
  cardTitle: { fontSize: 18, fontWeight: '700' },
  verseCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 18,
    marginBottom: 14,
  },
  verseKicker: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  verseArabic: { fontSize: 26, lineHeight: 46, textAlign: 'right', writingDirection: 'rtl', marginTop: 12 },
  verseTrans: { fontSize: 15, lineHeight: 23, marginTop: 12 },
  verseRef: { fontSize: 13, marginTop: 10, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  quick: {
    width: '48.5%',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 20,
    alignItems: 'center',
    marginBottom: 12,
  },
  quickLabel: { fontSize: 14, fontWeight: '600', marginTop: 8 },
  nudge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  nudgeText: { fontSize: 13, marginLeft: 10, flex: 1 },
});
