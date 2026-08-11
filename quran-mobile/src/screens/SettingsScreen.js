// Preferences: translation, reciter, show-translation toggle, the hourly Malay
// verse notification, and prayer-time calculation method.
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import Screen from '../components/Screen';
import { useSettings } from '../context/SettingsContext';
import { cancelHourlyVerses, scheduleHourlyVerses } from '../lib/notifications';
import { radius, useColors } from '../theme';

// Curated shortlists keep Settings simple; the API exposes many more editions.
const TRANSLATIONS = [
  { id: 'ms.basmeih', label: 'Melayu — Basmeih' },
  { id: 'id.indonesian', label: 'Indonesia — Kemenag' },
  { id: 'en.sahih', label: 'English — Saheeh International' },
  { id: 'en.pickthall', label: 'English — Pickthall' },
];

const RECITERS = [
  { id: 'ar.alafasy', label: 'Mishary Alafasy' },
  { id: 'ar.abdulbasitmurattal', label: 'Abdul Basit (Murattal)' },
  { id: 'ar.husary', label: 'Mahmoud Al-Husary' },
  { id: 'ar.abdurrahmaansudais', label: 'Abdurrahman As-Sudais' },
];

const METHODS = [
  { id: 3, label: 'Muslim World League' },
  { id: 2, label: 'ISNA (Amerika Utara)' },
  { id: 4, label: 'Umm al-Qura (Makkah)' },
  { id: 11, label: 'JAKIM (Malaysia)' },
];

export default function SettingsScreen() {
  const c = useColors();
  const { settings, update } = useSettings();
  const [busy, setBusy] = useState(false);

  async function onToggleHourly(value) {
    setBusy(true);
    try {
      if (value) {
        const count = await scheduleHourlyVerses({
          translation: settings.translation,
          reciter: settings.reciter,
        });
        update({ hourlyVerse: true });
        Alert.alert(
          'Ayat setiap jam dihidupkan',
          `${count} ayat seterusnya telah dijadualkan dalam ${labelFor(TRANSLATIONS, settings.translation)}.`
        );
      } else {
        await cancelHourlyVerses();
        update({ hourlyVerse: false });
      }
    } catch (e) {
      Alert.alert('Tidak dapat menjadualkan', e.message || 'Sila benarkan kebenaran notifikasi.');
    } finally {
      setBusy(false);
    }
  }

  // If the translation changes while hourly verses are on, re-arm them so the
  // next batch uses the new language.
  async function onPickTranslation(id) {
    update({ translation: id });
    if (settings.hourlyVerse) {
      try {
        await scheduleHourlyVerses({ translation: id, reciter: settings.reciter });
      } catch {
        /* keep old schedule if re-arming fails */
      }
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Section title="Bacaan" c={c}>
          <ToggleRow
            c={c}
            icon="language"
            label="Papar terjemahan"
            value={settings.showTranslation}
            onValueChange={(v) => update({ showTranslation: v })}
          />
        </Section>

        <Section title="Peringatan" c={c}>
          <ToggleRow
            c={c}
            icon="notifications"
            label="Ayat Al-Quran setiap jam"
            sub="Notifikasi ayat + terjemahan setiap jam. Ketik untuk dengar bacaan."
            value={settings.hourlyVerse}
            disabled={busy}
            onValueChange={onToggleHourly}
          />
        </Section>

        <Section title="Terjemahan" c={c}>
          {TRANSLATIONS.map((t) => (
            <SelectRow
              key={t.id}
              c={c}
              label={t.label}
              selected={settings.translation === t.id}
              onPress={() => onPickTranslation(t.id)}
            />
          ))}
        </Section>

        <Section title="Qari" c={c}>
          {RECITERS.map((r) => (
            <SelectRow
              key={r.id}
              c={c}
              label={r.label}
              selected={settings.reciter === r.id}
              onPress={() => update({ reciter: r.id })}
            />
          ))}
        </Section>

        <Section title="Kaedah Waktu Solat" c={c}>
          {METHODS.map((m) => (
            <SelectRow
              key={m.id}
              c={c}
              label={m.label}
              selected={settings.calcMethod === m.id}
              onPress={() => update({ calcMethod: m.id, city: null })}
            />
          ))}
        </Section>

        <Text style={[styles.about, { color: c.textMuted }]}>
          Nur Quran · Teks & audio daripada AlQuran Cloud · Waktu solat daripada AlAdhan.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function labelFor(list, id) {
  return list.find((x) => x.id === id)?.label || id;
}

function Section({ title, c, children }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: c.textMuted }]}>{title.toUpperCase()}</Text>
      <View style={[styles.group, { backgroundColor: c.surface, borderColor: c.border }]}>
        {children}
      </View>
    </View>
  );
}

function ToggleRow({ c, icon, label, sub, value, onValueChange, disabled }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={20} color={c.primary} style={styles.rowIcon} />
      <View style={styles.rowMid}>
        <Text style={[styles.rowLabel, { color: c.text }]}>{label}</Text>
        {!!sub && <Text style={[styles.rowSub, { color: c.textMuted }]}>{sub}</Text>}
      </View>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} />
    </View>
  );
}

function SelectRow({ c, label, selected, onPress }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Text style={[styles.rowLabel, { color: c.text, flex: 1 }]}>{label}</Text>
      {selected && <Ionicons name="checkmark-circle" size={22} color={c.primary} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 14, paddingBottom: 28 },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 8, marginLeft: 4 },
  group: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowIcon: { marginRight: 12 },
  rowMid: { flex: 1, marginRight: 10 },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  rowSub: { fontSize: 12, marginTop: 3, lineHeight: 17 },
  about: { fontSize: 12, textAlign: 'center', marginTop: 8, lineHeight: 18 },
});
