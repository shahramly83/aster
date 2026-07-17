// Supabase client for React Native. Same project + anon key as the web app; the
// only difference is the storage adapter (AsyncStorage instead of the browser's
// localStorage) so the session survives app restarts. All access is RLS-gated.
import "react-native-url-polyfill/auto";
import { createClient, processLock } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

// Prefer EXPO_PUBLIC_* env vars; fall back to app.json `extra` so a build can bake
// them in without a .env present.
const extra = Constants.expoConfig?.extra || {};
const url = process.env.EXPO_PUBLIC_SUPABASE_URL || extra.supabaseUrl || "";
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || extra.supabaseAnonKey || "";

export const hasSupabase = Boolean(url && anonKey);

if (!hasSupabase) {
  // eslint-disable-next-line no-console
  console.warn("[supabase] EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY not set — sign-in will not work. Copy .env.example to .env.");
}

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    // No URL-based session detection on native; auth is handled in-app.
    detectSessionInUrl: false,
    // React Native has no Web Locks API (navigator.locks); without this,
    // getSession() can hang forever waiting on a lock that never resolves,
    // leaving the app stuck on the boot spinner. processLock is supabase-js's
    // RN-safe lock implementation.
    lock: processLock,
  },
});
