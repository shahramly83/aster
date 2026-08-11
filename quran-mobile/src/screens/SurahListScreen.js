// Browsable, searchable list of all 114 surahs.
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import Screen from '../components/Screen';
import SurahCard from '../components/SurahCard';
import { fetchSurahList } from '../lib/api';
import { radius, useColors } from '../theme';

export default function SurahListScreen({ navigation }) {
  const c = useColors();
  const [surahs, setSurahs] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchSurahList()
      .then((list) => alive && setSurahs(list))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return surahs;
    return surahs.filter(
      (s) =>
        s.englishName.toLowerCase().includes(q) ||
        s.englishNameTranslation.toLowerCase().includes(q) ||
        String(s.number) === q
    );
  }, [surahs, query]);

  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={c.textMuted} />
          <Text style={[styles.errorText, { color: c.textMuted }]}>
            Tidak dapat memuatkan senarai surah.{'\n'}Semak sambungan internet anda.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={[styles.searchWrap, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Ionicons name="search" size={18} color={c.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Cari surah…"
          placeholderTextColor={c.textMuted}
          style={[styles.search, { color: c.text }]}
        />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.number)}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <SurahCard
            surah={item}
            onPress={() =>
              navigation.navigate('Reader', {
                surah: item.number,
                name: item.englishName,
              })
            }
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { textAlign: 'center', marginTop: 12, fontSize: 14, lineHeight: 20 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginTop: 8,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  search: { flex: 1, marginLeft: 8, fontSize: 15 },
  list: { padding: 12, paddingBottom: 24 },
});
