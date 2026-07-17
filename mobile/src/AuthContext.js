// Auth + session state for the whole app. Wraps Supabase auth, loads the
// interviewer session, registers for push, and provides an optional biometric
// app-lock so a returning user unlocks with Face ID / fingerprint instead of
// re-typing credentials.
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";
import { supabase } from "./lib/supabase";
import { loadSession, loadAssignedJobIds } from "./lib/session";
import { registerForPush, unregisterPush } from "./lib/push";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

const BIOMETRIC_PREF_KEY = "aster.biometric.enabled";

export function AuthProvider({ children }) {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState(null); // Supabase auth session
  const [profile, setProfile] = useState(null); // interviewer session (company, role, tz)
  const [assignedJobIds, setAssignedJobIds] = useState([]);
  const [locked, setLocked] = useState(false);

  const hydrate = useCallback(async () => {
    const s = await loadSession();
    setProfile(s);
    if (s) {
      const ids = await loadAssignedJobIds(s.companyId, s.userId);
      setAssignedJobIds(ids);
      registerForPush(s.userId).catch(() => {});
    }
    return s;
  }, []);

  // Boot: restore any persisted session, then hydrate the profile.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
      if (data.session) {
        await hydrate();
        // If biometric lock is on, require an unlock before showing anything.
        const pref = await SecureStore.getItemAsync(BIOMETRIC_PREF_KEY);
        if (pref === "1") setLocked(true);
      }
      setBooting(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) {
        setProfile(null);
        setAssignedJobIds([]);
        setLocked(false);
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [hydrate]);

  const signIn = useCallback(
    async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      await hydrate();
    },
    [hydrate]
  );

  const signOut = useCallback(async () => {
    await unregisterPush().catch(() => {});
    await supabase.auth.signOut();
  }, []);

  const unlock = useCallback(async () => {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!hasHardware || !enrolled) {
      setLocked(false);
      return true;
    }
    const res = await LocalAuthentication.authenticateAsync({ promptMessage: "Unlock Aster" });
    if (res.success) setLocked(false);
    return res.success;
  }, []);

  const setBiometricEnabled = useCallback(async (on) => {
    await SecureStore.setItemAsync(BIOMETRIC_PREF_KEY, on ? "1" : "0");
  }, []);

  const value = {
    booting,
    signedIn: !!session,
    session,
    profile,
    assignedJobIds,
    locked,
    signIn,
    signOut,
    unlock,
    setBiometricEnabled,
    refresh: hydrate,
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
