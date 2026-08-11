// App-wide preferences (translation, reciter, hourly-verse toggle, prayer calc
// method, saved location). Persisted through lib/storage and exposed via a hook.
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../lib/storage';

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setReady(true);
    });
  }, []);

  const value = useMemo(() => {
    async function update(patch) {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        saveSettings(next); // fire-and-forget persistence
        return next;
      });
    }
    return { settings, update, ready };
  }, [settings, ready]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
