// Hourly "verse of the hour" notifications, in the user's chosen translation
// (Malay by default). Because Expo local notifications carry fixed content, we
// pre-schedule the next N hours — each with a real ayah's Arabic + Malay text —
// and re-arm the rolling window whenever the app comes to the foreground.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { fetchAyah, TOTAL_AYAHS } from './api';

const HOURS_AHEAD = 12; // rolling window of pre-scheduled verses
const ANDROID_CHANNEL = 'hourly-verse';

// Foreground behaviour: still show the banner so the feature is visible in dev.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function ensurePermissions() {
  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
      name: 'Hourly verse',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#0E5C4A',
    });
  }
  return status === 'granted';
}

// Pick N distinct random global ayah numbers (1..6236). Deterministic-enough;
// duplicates across re-arms are fine.
function pickAyahNumbers(count) {
  const set = new Set();
  while (set.size < count) {
    set.add(1 + Math.floor(Math.random() * TOTAL_AYAHS));
  }
  return [...set];
}

// (Re)schedule the hourly verses. Cancels any previously scheduled ones first
// so we never stack duplicates. Returns the number scheduled.
export async function scheduleHourlyVerses({ translation, reciter }) {
  const granted = await ensurePermissions();
  if (!granted) throw new Error('Notification permission not granted');

  await cancelHourlyVerses();

  const numbers = pickAyahNumbers(HOURS_AHEAD);
  const now = Date.now();
  let scheduled = 0;

  for (let i = 0; i < numbers.length; i++) {
    let ayah;
    try {
      ayah = await fetchAyah(numbers[i], translation, reciter);
    } catch {
      continue; // skip a bad fetch rather than aborting the whole window
    }
    const fireDate = new Date(now + (i + 1) * 60 * 60 * 1000);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${ayah.surah.englishName} · ${ayah.numberInSurah}`,
        body: ayah.translation || ayah.arabic,
        data: {
          type: 'hourly-verse',
          surah: ayah.surah.number,
          ayah: ayah.numberInSurah,
          audio: ayah.audio,
        },
        ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL } : {}),
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireDate },
    });
    scheduled++;
  }
  return scheduled;
}

export async function cancelHourlyVerses() {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    all
      .filter((n) => n.content?.data?.type === 'hourly-verse')
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
  );
}

// Subscribe to notification taps; hands the payload's { surah, ayah } to a
// navigator callback. Returns an unsubscribe function.
export function onNotificationTap(handler) {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data;
    if (data?.type === 'hourly-verse') handler(data);
  });
  return () => sub.remove();
}
