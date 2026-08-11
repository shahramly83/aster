// Prayer times for the device location (with graceful fallback) plus a simple
// Qibla bearing and a live compass built from the magnetometer.
import { Ionicons } from '@expo/vector-icons';
import { Magnetometer } from 'expo-sensors';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import Screen from '../components/Screen';
import { useSettings } from '../context/SettingsContext';
import { fetchPrayerTimes, fetchQibla } from '../lib/api';
import { getCoordinates } from '../lib/location';
import { radius, useColors } from '../theme';

const PRAYER_LABELS = {
  Fajr: 'Subuh',
  Sunrise: 'Syuruk',
  Dhuhr: 'Zohor',
  Asr: 'Asar',
  Maghrib: 'Maghrib',
  Isha: 'Isyak',
};

function headingFromMagnetometer({ x, y }) {
  let angle = Math.atan2(y, x) * (180 / Math.PI);
  if (angle < 0) angle += 360;
  return angle;
}

export default function PrayerTimesScreen() {
  const c = useColors();
  const { settings, update } = useSettings();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [place, setPlace] = useState(null);
  const [qibla, setQibla] = useState(null);
  const [heading, setHeading] = useState(0);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const coords = settings.city || (await getCoordinates());
      setPlace(coords);
      if (!settings.city) update({ city: coords });
      const [times, qiblaDir] = await Promise.all([
        fetchPrayerTimes({
          latitude: coords.latitude,
          longitude: coords.longitude,
          method: settings.calcMethod,
        }),
        fetchQibla(coords.latitude, coords.longitude),
      ]);
      setData(times);
      setQibla(qiblaDir);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [settings.city, settings.calcMethod]);

  useEffect(() => {
    load();
  }, [load]);

  // Live compass heading (best-effort; devices without a magnetometer just sit at 0).
  useEffect(() => {
    Magnetometer.setUpdateInterval(200);
    const sub = Magnetometer.addListener((reading) => {
      setHeading(headingFromMagnetometer(reading));
    });
    return () => sub.remove();
  }, []);

  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      </Screen>
    );
  }

  // Rotate the needle so it points to Qibla relative to where the phone faces.
  const needleRotation = qibla != null ? qibla - heading : 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.locRow}>
          <Ionicons name="location" size={16} color={c.primary} />
          <Text style={[styles.loc, { color: c.text }]}>
            {place?.name || 'Lokasi'}
            {place?.approximate ? ' (anggaran)' : ''}
          </Text>
          <Pressable hitSlop={10} onPress={load} style={{ marginLeft: 'auto' }}>
            <Ionicons name="refresh" size={18} color={c.textMuted} />
          </Pressable>
        </View>
        {data && (
          <Text style={[styles.hijri, { color: c.textMuted }]}>
            {data.date} · {data.hijri}
          </Text>
        )}

        {error && (
          <Text style={[styles.error, { color: c.danger }]}>
            Tidak dapat memuatkan waktu solat.
          </Text>
        )}

        {data?.timings.map((t) => (
          <View
            key={t.name}
            style={[styles.prayerRow, { backgroundColor: c.surface, borderColor: c.border }]}
          >
            <Text style={[styles.prayerName, { color: c.text }]}>
              {PRAYER_LABELS[t.name] || t.name}
            </Text>
            <Text style={[styles.prayerTime, { color: c.primary }]}>{t.time}</Text>
          </View>
        ))}

        {qibla != null && (
          <View style={[styles.qiblaCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[styles.qiblaLabel, { color: c.textMuted }]}>Arah Kiblat</Text>
            <View style={styles.compass}>
              <Ionicons
                name="navigate"
                size={64}
                color={c.primary}
                style={{ transform: [{ rotate: `${needleRotation}deg` }] }}
              />
            </View>
            <Text style={[styles.qiblaDeg, { color: c.text }]}>
              {Math.round(qibla)}° dari Utara
            </Text>
            <Text style={[styles.qiblaHint, { color: c.textMuted }]}>
              Pusingkan telefon sehingga anak panah menghala ke atas.
            </Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 14, paddingBottom: 28 },
  locRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  loc: { fontSize: 15, fontWeight: '700', marginLeft: 6 },
  hijri: { fontSize: 13, marginBottom: 14 },
  error: { fontSize: 14, marginBottom: 12 },
  prayerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginBottom: 8,
  },
  prayerName: { fontSize: 16, fontWeight: '600' },
  prayerTime: { fontSize: 18, fontWeight: '700' },
  qiblaCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 22,
    alignItems: 'center',
    marginTop: 14,
  },
  qiblaLabel: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  compass: { marginVertical: 18 },
  qiblaDeg: { fontSize: 20, fontWeight: '800' },
  qiblaHint: { fontSize: 12, textAlign: 'center', marginTop: 8, lineHeight: 18 },
});
