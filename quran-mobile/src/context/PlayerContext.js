// Audio recitation engine. Wraps a single expo-av Sound and a queue of ayahs so
// the app can play one verse or stream a whole surah with auto-advance. The
// MiniPlayer and ReaderScreen both drive playback through this one hook, so
// there is never more than one Sound alive at a time.
import { Audio } from 'expo-av';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const soundRef = useRef(null);
  const queueRef = useRef([]); // array of ayah objects with .audio
  const [current, setCurrent] = useState(null); // currently loaded ayah
  const [index, setIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Configure the audio session once: keep playing in the background / silent mode.
  useEffect(() => {
    Audio.setAudioModeAsync({
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
    }).catch(() => {});
    return () => {
      if (soundRef.current) soundRef.current.unloadAsync().catch(() => {});
    };
  }, []);

  const unload = useCallback(async () => {
    if (soundRef.current) {
      try {
        await soundRef.current.unloadAsync();
      } catch {
        /* already gone */
      }
      soundRef.current = null;
    }
  }, []);

  // Load + play the ayah at a queue index. Declared as a ref-held function so
  // the playback-status callback can advance without a stale closure.
  const playIndexRef = useRef(null);
  const playIndex = useCallback(
    async (i) => {
      const queue = queueRef.current;
      if (i < 0 || i >= queue.length) {
        // Reached the end of the queue.
        setIsPlaying(false);
        return;
      }
      const ayah = queue[i];
      if (!ayah?.audio) {
        // No audio for this ayah — skip forward so playback doesn't stall.
        return playIndexRef.current(i + 1);
      }
      setIsLoading(true);
      await unload();
      try {
        const { sound } = await Audio.Sound.createAsync(
          { uri: ayah.audio },
          { shouldPlay: true },
          (status) => {
            if (!status.isLoaded) return;
            setIsPlaying(status.isPlaying);
            if (status.didJustFinish) {
              playIndexRef.current(i + 1); // auto-advance
            }
          }
        );
        soundRef.current = sound;
        setCurrent(ayah);
        setIndex(i);
      } catch {
        setIsPlaying(false);
      } finally {
        setIsLoading(false);
      }
    },
    [unload]
  );
  playIndexRef.current = playIndex;

  // Public: play a queue (array of ayahs) starting at `start`.
  const playQueue = useCallback(
    async (ayahs, start = 0) => {
      queueRef.current = ayahs;
      await playIndex(start);
    },
    [playIndex]
  );

  // Public: play a single ayah on its own.
  const playAyah = useCallback(
    async (ayah) => {
      queueRef.current = [ayah];
      await playIndex(0);
    },
    [playIndex]
  );

  const togglePlay = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) return;
    const status = await sound.getStatusAsync();
    if (!status.isLoaded) return;
    if (status.isPlaying) {
      await sound.pauseAsync();
      setIsPlaying(false);
    } else {
      await sound.playAsync();
      setIsPlaying(true);
    }
  }, []);

  const next = useCallback(() => playIndex(index + 1), [index, playIndex]);
  const prev = useCallback(() => playIndex(Math.max(0, index - 1)), [index, playIndex]);

  const stop = useCallback(async () => {
    await unload();
    queueRef.current = [];
    setCurrent(null);
    setIndex(-1);
    setIsPlaying(false);
  }, [unload]);

  const value = useMemo(
    () => ({
      current,
      index,
      isPlaying,
      isLoading,
      playQueue,
      playAyah,
      togglePlay,
      next,
      prev,
      stop,
    }),
    [current, index, isPlaying, isLoading, playQueue, playAyah, togglePlay, next, prev, stop]
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider');
  return ctx;
}
