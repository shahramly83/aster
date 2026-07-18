// Push-notification registration. Asks for permission, gets an Expo push token,
// and upserts it into the `device_tokens` table (see migration
// supabase/migrations/0108_device_tokens.sql) keyed to the signed-in user so the
// server can fan out to this device. Safe to call on every launch.
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { supabase } from "./supabase";

// Per-device push preference. "0" = the user turned push off in Settings.
export const PUSH_PREF_KEY = "aster.push.enabled";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPush(userId) {
  // Respect the user's Settings toggle: if they turned push off, don't register.
  try { if ((await SecureStore.getItemAsync(PUSH_PREF_KEY)) === "0") return null; } catch { /* default on */ }

  // Push only works on a physical device.
  if (!Constants.isDevice && Constants.deviceName === undefined) {
    // Best-effort: some simulators still return a token; don't hard-fail.
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Aster",
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: "#0B2AE0",
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== "granted") return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
  const tokenResp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  const token = tokenResp.data;
  if (!token || !userId) return token;

  // Upsert so re-launches don't create duplicate rows for the same device.
  await supabase.from("device_tokens").upsert(
    { user_id: userId, token, platform: Platform.OS },
    { onConflict: "token" }
  );
  return token;
}

// Remove this device's token on sign-out so a signed-out phone stops receiving push.
export async function unregisterPush() {
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
    const tokenResp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    if (tokenResp?.data) await supabase.from("device_tokens").delete().eq("token", tokenResp.data);
  } catch {
    /* token unavailable (e.g. permission revoked) — nothing to clean up */
  }
}
