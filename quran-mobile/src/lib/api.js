// Thin data layer over two free, key-less public APIs:
//   - AlQuran Cloud (https://alquran.cloud/api) — surahs, ayah text, translations, audio
//   - AlAdhan       (https://aladhan.com/prayer-times-api) — prayer times + qibla
//
// Everything returns plain JS objects; screens never see raw fetch responses.
// A tiny in-memory cache avoids re-fetching a surah the user flips back to.

const QURAN_BASE = 'https://api.alquran.cloud/v1';
const ADHAN_BASE = 'https://api.aladhan.com/v1';

const memo = new Map();

async function getJson(url) {
  if (memo.has(url)) return memo.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status}) for ${url}`);
  const body = await res.json();
  if (body.code && body.code !== 200) {
    throw new Error(body.status || 'API error');
  }
  memo.set(url, body);
  return body;
}

// ---- Quran ----------------------------------------------------------------

// Full list of the 114 surahs (cheap, ~15KB). Cached for the session.
export async function fetchSurahList() {
  const body = await getJson(`${QURAN_BASE}/surah`);
  return body.data.map((s) => ({
    number: s.number,
    name: s.name, // Arabic
    englishName: s.englishName, // transliteration
    englishNameTranslation: s.englishNameTranslation,
    numberOfAyahs: s.numberOfAyahs,
    revelationType: s.revelationType, // "Meccan" | "Medinan"
  }));
}

// A single surah with Arabic text, a translation, and per-ayah audio, aligned
// by index into one array of ayah objects. `translation` and `reciter` are
// AlQuran Cloud edition identifiers (e.g. "ms.basmeih", "ar.alafasy").
export async function fetchSurah(number, translation, reciter) {
  const editions = ['quran-uthmani', translation, reciter].join(',');
  const body = await getJson(`${QURAN_BASE}/surah/${number}/editions/${editions}`);
  const [arabic, trans, audio] = body.data;

  const ayahs = arabic.ayahs.map((a, i) => ({
    number: a.number, // global ayah number (1..6236)
    numberInSurah: a.numberInSurah,
    juz: a.juz,
    page: a.page,
    arabic: a.text,
    translation: trans?.ayahs?.[i]?.text ?? '',
    audio: audio?.ayahs?.[i]?.audio ?? null,
    sajda: !!a.sajda,
  }));

  return {
    number: arabic.number,
    name: arabic.name,
    englishName: arabic.englishName,
    englishNameTranslation: arabic.englishNameTranslation,
    revelationType: arabic.revelationType,
    numberOfAyahs: arabic.numberOfAyahs,
    ayahs,
  };
}

// One specific ayah by global number — used for the "verse of the hour"
// notification without needing the whole surah in memory.
export async function fetchAyah(globalNumber, translation, reciter) {
  const editions = ['quran-uthmani', translation, reciter].join(',');
  const body = await getJson(`${QURAN_BASE}/ayah/${globalNumber}/editions/${editions}`);
  const [arabic, trans, audio] = body.data;
  return {
    number: arabic.number,
    numberInSurah: arabic.numberInSurah,
    surah: {
      number: arabic.surah.number,
      englishName: arabic.surah.englishName,
      name: arabic.surah.name,
    },
    arabic: arabic.text,
    translation: trans?.text ?? '',
    audio: audio?.audio ?? null,
  };
}

// Available translation editions in a given language (default Malay), so the
// Settings screen can offer real choices instead of a hardcoded list.
export async function fetchTranslations(language = 'ms') {
  const body = await getJson(`${QURAN_BASE}/edition/language/${language}`);
  return body.data
    .filter((e) => e.format === 'text' && e.type === 'translation')
    .map((e) => ({ identifier: e.identifier, name: e.englishName, language: e.language }));
}

export async function fetchReciters() {
  const body = await getJson(`${QURAN_BASE}/edition/format/audio`);
  return body.data
    .filter((e) => e.type === 'versebyverse')
    .map((e) => ({ identifier: e.identifier, name: e.englishName, language: e.language }));
}

export const TOTAL_AYAHS = 6236;

// ---- Prayer times + Qibla -------------------------------------------------

// Returns the five daily prayers (+ sunrise) as { name, time } for a date.
// `method` is an AlAdhan calculation method id (default 3 = Muslim World League).
export async function fetchPrayerTimes({ latitude, longitude, date = new Date(), method = 3 }) {
  const d = `${String(date.getDate()).padStart(2, '0')}-${String(
    date.getMonth() + 1
  ).padStart(2, '0')}-${date.getFullYear()}`;
  const url = `${ADHAN_BASE}/timings/${d}?latitude=${latitude}&longitude=${longitude}&method=${method}`;
  const body = await getJson(url);
  const t = body.data.timings;
  const order = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  return {
    date: body.data.date.readable,
    hijri: `${body.data.date.hijri.day} ${body.data.date.hijri.month.en} ${body.data.date.hijri.year} AH`,
    timings: order.map((name) => ({ name, time: t[name] })),
  };
}

export async function fetchQibla(latitude, longitude) {
  const body = await getJson(`${ADHAN_BASE}/qibla/${latitude}/${longitude}`);
  return body.data.direction; // degrees clockwise from true north
}
