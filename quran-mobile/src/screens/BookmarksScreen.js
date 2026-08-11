// Saved ayahs. Tap to jump into the reader at that ayah; swipe-free delete via
// a trailing button. Reloads whenever the screen regains focus.
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import Screen from '../components/Screen';
import { getBookmarks, removeBookmark } from '../lib/storage';
import { radius, useColors } from '../theme';

export default function BookmarksScreen({ navigation }) {
  const c = useColors();
  const [bookmarks, setBookmarks] = useState([]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getBookmarks().then((list) => alive && setBookmarks(list));
      return () => {
        alive = false;
      };
    }, [])
  );

  const onRemove = useCallback(async (b) => {
    const next = await removeBookmark(b.surah, b.ayah);
    setBookmarks(next);
  }, []);

  if (bookmarks.length === 0) {
    return (
      <Screen>
        <View style={styles.center}>
          <Ionicons name="bookmark-outline" size={44} color={c.textMuted} />
          <Text style={[styles.emptyTitle, { color: c.text }]}>Tiada penanda</Text>
          <Text style={[styles.emptyText, { color: c.textMuted }]}>
            Ketik ikon penanda pada mana-mana ayat untuk menyimpannya di sini.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={bookmarks}
        keyExtractor={(b) => `${b.surah}:${b.ayah}`}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              navigation.navigate('QuranTab', {
                screen: 'Reader',
                params: { surah: item.surah, name: item.surahName, scrollToAyah: item.ayah },
                initial: false,
              })
            }
            style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
          >
            <View style={styles.cardHead}>
              <Text style={[styles.ref, { color: c.primary }]}>
                {item.surahName} · {item.ayah}
              </Text>
              <Pressable hitSlop={10} onPress={() => onRemove(item)}>
                <Ionicons name="trash-outline" size={18} color={c.danger} />
              </Pressable>
            </View>
            <Text style={[styles.arabic, { color: c.arabic }]} numberOfLines={2}>
              {item.arabic}
            </Text>
            {!!item.translation && (
              <Text style={[styles.trans, { color: c.translation }]} numberOfLines={2}>
                {item.translation}
              </Text>
            )}
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginTop: 14 },
  emptyText: { fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  list: { padding: 12 },
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginBottom: 10,
  },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  ref: { fontSize: 14, fontWeight: '700' },
  arabic: { fontSize: 22, lineHeight: 38, textAlign: 'right', writingDirection: 'rtl' },
  trans: { fontSize: 14, lineHeight: 21, marginTop: 8 },
});
