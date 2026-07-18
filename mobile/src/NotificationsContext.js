// Tracks unread notification count for the bell badge. There's no per-user read
// state server-side, so "read" is a per-device high-water mark stored in
// SecureStore: unread = number of activity_log rows newer than the last time
// this device opened the Notifications screen. Recomputed on the same realtime
// channel the dashboard uses, and cleared (markAllRead) when Notifications opens.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { useAuth } from "./AuthContext";
import { supabase } from "./lib/supabase";
import { subscribeDashboard } from "./lib/data";

const KEY = "notif_last_seen";
const Ctx = createContext({ unread: 0, markAllRead: async () => {}, refresh: async () => {} });
export const useNotifications = () => useContext(Ctx);

export function NotificationsProvider({ children }) {
  const { profile } = useAuth();
  const [unread, setUnread] = useState(0);
  const lastSeenRef = useRef(null);

  const compute = useCallback(async () => {
    if (!profile?.companyId) { setUnread(0); return; }
    if (lastSeenRef.current === null) {
      lastSeenRef.current = (await SecureStore.getItemAsync(KEY).catch(() => null)) || "1970-01-01T00:00:00Z";
    }
    const { count } = await supabase
      .from("activity_log")
      .select("id", { count: "exact", head: true })
      .eq("company_id", profile.companyId)
      .gt("created_at", lastSeenRef.current);
    setUnread(count || 0);
  }, [profile?.companyId]);

  useEffect(() => {
    let active = true;
    compute();
    if (!profile?.companyId) return undefined;
    const unsub = subscribeDashboard(profile.companyId, () => { if (active) compute(); });
    return () => { active = false; unsub(); };
  }, [profile?.companyId, compute]);

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    lastSeenRef.current = now;
    setUnread(0);
    try { await SecureStore.setItemAsync(KEY, now); } catch { /* best-effort */ }
  }, []);

  return <Ctx.Provider value={{ unread, markAllRead, refresh: compute }}>{children}</Ctx.Provider>;
}
