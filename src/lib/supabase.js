// Supabase browser client.
//
// Reads config from Vite env vars (see .env.example). If they are not set, the
// client is null and the app keeps running on its built-in mock data, so the
// preview never breaks before the backend is wired up.
//
// The anon key is safe in the browser: all data access is gated by Row Level
// Security policies in the database. The service_role key must NEVER appear here.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabase = Boolean(url && anonKey);

if (!hasSupabase && import.meta.env.DEV) {
  // eslint-disable-next-line no-console
  console.info("[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — running on mock data.");
}

export const supabase = hasSupabase
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
