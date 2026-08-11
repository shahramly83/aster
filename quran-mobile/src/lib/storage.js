// All local persistence lives here (AsyncStorage). Keys are namespaced so a
// single storage inspection shows exactly what the app keeps on-device:
//   nq:settings   → user preferences (translation, reciter, hourly toggle...)
//   nq:lastread   → { surah, ayah, name } for "continue reading"
//   nq:bookmarks  → array of { surah, ayah, surahName, arabic, translation, ts }
import AsyncStorage from '@react-native-async-storage/async-storage';

const K = {
  settings: 'nq:settings',
  lastRead: 'nq:lastread',
  bookmarks: 'nq:bookmarks',
};

async function readJson(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(key, value) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

// ---- Settings -------------------------------------------------------------

export const DEFAULT_SETTINGS = {
  translation: 'ms.basmeih', // Malay (Basmeih)
  reciter: 'ar.alafasy', // Mishary Alafasy
  showTranslation: true,
  hourlyVerse: false, // hourly Malay verse notification
  calcMethod: 3, // AlAdhan: Muslim World League
  city: null, // { name, latitude, longitude } cached from location or manual
};

export async function loadSettings() {
  const saved = await readJson(K.settings, {});
  return { ...DEFAULT_SETTINGS, ...saved };
}

export async function saveSettings(settings) {
  await writeJson(K.settings, settings);
}

// ---- Last read ------------------------------------------------------------

export async function getLastRead() {
  return readJson(K.lastRead, null);
}

export async function setLastRead(entry) {
  // entry: { surah, ayah, name }
  await writeJson(K.lastRead, { ...entry, ts: Date.now() });
}

// ---- Bookmarks ------------------------------------------------------------

export async function getBookmarks() {
  return readJson(K.bookmarks, []);
}

function keyOf(b) {
  return `${b.surah}:${b.ayah}`;
}

export async function toggleBookmark(bookmark) {
  const list = await getBookmarks();
  const idx = list.findIndex((b) => keyOf(b) === keyOf(bookmark));
  let next;
  if (idx >= 0) {
    next = list.filter((_, i) => i !== idx);
  } else {
    next = [{ ...bookmark, ts: Date.now() }, ...list];
  }
  await writeJson(K.bookmarks, next);
  return next;
}

export async function isBookmarked(surah, ayah) {
  const list = await getBookmarks();
  return list.some((b) => b.surah === surah && b.ayah === ayah);
}

export async function removeBookmark(surah, ayah) {
  const list = await getBookmarks();
  const next = list.filter((b) => !(b.surah === surah && b.ayah === ayah));
  await writeJson(K.bookmarks, next);
  return next;
}
