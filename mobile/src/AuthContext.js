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
import { isManagerRole } from "@aster/shared";

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
    if (s) {
      // Resolve the panel assignments BEFORE exposing the profile. An
      // interviewer's Open Positions are scoped to assignedJobIds, so if profile
      // went live first the screen would load with an empty id list and flash
      // "No open positions" before the real roles arrived. Setting both together
      // means the screen stays on its loader until we actually know the answer.
      let ids = [];
      try { ids = await loadAssignedJobIds(s.companyId, s.userId); } catch (e) { console.error("[hydrate] assignments:", e?.message || e); }
      setAssignedJobIds(ids);
      setProfile(s);
      registerForPush(s.userId).catch(() => {});
      // Tell the owner/admins this teammate has actually turned up. An
      // interviewer may only ever open the phone app, so the web app firing
      // this is not enough. The stamp is claimed server-side with an `is null`
      // filter, so web and mobile racing still yields one notification.
      supabase.functions.invoke("notify-first-login").catch(() => {});
    } else {
      setProfile(null);
      setAssignedJobIds([]);
    }
    return s;
  }, []);

  // Boot: restore any persisted session, then hydrate the profile.
  // Wrapped so a slow/throwing getSession or hydrate can NEVER leave the app
  // hanging on the loader — worst case we fall through to the sign-in screen.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        setSession(data.session);
        if (data.session) {
          await hydrate();
          // If biometric lock is on, require an unlock before showing anything.
          const pref = await SecureStore.getItemAsync(BIOMETRIC_PREF_KEY);
          if (pref === "1") setLocked(true);
        }
      } catch (e) {
        console.error("[boot] failed:", e?.message || e);
      } finally {
        if (mounted) setBooting(false);
      }
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
    // Managers (owner/admin/recruiter) get the pipeline experience; interviewers
    // get the focused panel experience. Used to pick nav + gate features.
    manager: isManagerRole(profile?.role),
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
