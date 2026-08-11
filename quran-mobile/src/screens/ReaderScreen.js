// The reader: loads a surah (Arabic + translation + audio), renders ayahs, and
// wires per-ayah play/bookmark plus a "play whole surah" header action.
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import AyahRow from '../components/AyahRow';
import Screen from '../components/Screen';
import { usePlayer } from '../context/PlayerContext';
import { useSettings } from '../context/SettingsContext';
import { fetchSurah } from '../lib/api';
import { getBookmarks, setLastRead, toggleBookmark } from '../lib/storage';
import { radius, useColors } from '../theme';

// Bismillah is prepended to every surah except At-Tawbah (9); Al-Fatihah (1)
// already includes it as its first ayah.
const BISMILLAH = 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ';

export default function ReaderScreen({ route, navigation }) {
  const { surah: surahNumber, name, scrollToAyah } = route.params;
  const c = useColors();
  const { settings } = useSettings();
  const player = usePlayer();

  const [surah, setSurah] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bookmarkKeys, setBookmarkKeys] = useState(new Set());
  const listRef = useRef(null);

  // Build queue items enriched with the surah name for the mini-player.
  const queue = useMemo(() => {
    if (!surah) return [];
    return surah.ayahs.map((a) => ({ ...a, surahName: surah.englishName }));
  }, [surah]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchSurah(surahNumber, settings.translation, settings.reciter)
      .then((s) => {
        if (!alive) return;
        setSurah(s);
        setLastRead({ surah: s.number, ayah: 1, name: s.englishName });
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [surahNumber, settings.translation, settings.reciter]);

  useEffect(() => {
    let alive = true;
    getBookmarks().then((list) => {
      if (!alive) return;
      setBookmarkKeys(new Set(list.map((b) => `${b.surah}:${b.ayah}`)));
    });
    return () => {
      alive = false;
    };
  }, []);

  const playAll = useCallback(() => {
    if (queue.length) player.playQueue(queue, 0);
  }, [player, queue]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: name || `Surah ${surahNumber}`,
      headerRight: () => (
        <Pressable hitSlop={10} onPress={playAll} style={{ marginRight: 4 }}>
          <Ionicons name="play-circle" size={28} color={c.primary} />
        </Pressable>
      ),
    });
  }, [navigation, name, surahNumber, playAll, c.primary]);

  const onPlayAyah = useCallback(
    (i) => {
      const active = player.current && player.current.number === queue[i].number;
      if (active) {
        player.togglePlay();
      } else {
        player.playQueue(queue, i);
        setLastRead({ surah: surahNumber, ayah: queue[i].numberInSurah, name });
      }
    },
    [player, queue, surahNumber, name]
  );

  const onToggleBookmark = useCallback(
    async (ayah) => {
      const list = await toggleBookmark({
        surah: surahNumber,
        ayah: ayah.numberInSurah,
        surahName: name,
        arabic: ayah.arabic,
        translation: ayah.translation,
      });
      setBookmarkKeys(new Set(list.map((b) => `${b.surah}:${b.ayah}`)));
    },
    [surahNumber, name]
  );

  const onScrollFail = useRef(({ index }) => {
    // Fallback if the target row isn't measured yet.
    setTimeout(() => {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.2 });
    }, 300);
  }).current;

  useEffect(() => {
    if (!scrollToAyah || !surah) return;
    const idx = surah.ayahs.findIndex((a) => a.numberInSurah === scrollToAyah);
    if (idx > 0) {
      setTimeout(() => {
        listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.2 });
      }, 400);
    }
  }, [scrollToAyah, surah]);

  if (loading) {
    return (
      <Screen edges={[]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      </Screen>
    );
  }

  if (error || !surah) {
    return (
      <Screen edges={[]}>
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={c.textMuted} />
          <Text style={[styles.errorText, { color: c.textMuted }]}>
            Tidak dapat memuatkan surah ini.
          </Text>
        </View>
      </Screen>
    );
  }

  const showBismillah = surah.number !== 1 && surah.number !== 9;

  return (
    <Screen edges={[]}>
      <FlatList
        ref={listRef}
        data={surah.ayahs}
        keyExtractor={(item) => String(item.number)}
        contentContainerStyle={styles.list}
        onScrollToIndexFailed={onScrollFail}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[styles.surahName, { color: c.text }]}>{surah.englishName}</Text>
            <Text style={[styles.surahMeta, { color: c.textMuted }]}>
              {surah.englishNameTranslation} · {surah.revelationType} · {surah.numberOfAyahs} ayat
            </Text>
            {showBismillah && (
              <Text style={[styles.bismillah, { color: c.arabic }]}>{BISMILLAH}</Text>
            )}
          </View>
        }
        renderItem={({ item, index }) => (
          <AyahRow
            ayah={item}
            showTranslation={settings.showTranslation}
            isActive={player.current?.number === item.number && player.isPlaying}
            isBookmarked={bookmarkKeys.has(`${surahNumber}:${item.numberInSurah}`)}
            onPlay={() => onPlayAyah(index)}
            onToggleBookmark={() => onToggleBookmark(item)}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { textAlign: 'center', marginTop: 12, fontSize: 14 },
  list: { padding: 12, paddingBottom: 24 },
  header: { alignItems: 'center', paddingVertical: 16 },
  surahName: { fontSize: 24, fontWeight: '800' },
  surahMeta: { fontSize: 13, marginTop: 4 },
  bismillah: {
    fontSize: 26,
    lineHeight: 46,
    textAlign: 'center',
    writingDirection: 'rtl',
    marginTop: 18,
  },
});
