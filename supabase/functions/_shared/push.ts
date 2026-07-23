// Shared push helper for edge functions. Looks up a user's Expo push tokens from
// device_tokens (service-role read) and sends a notification via Expo's push API.
//
// Best-effort by contract: callers await it but must never let a push failure
// break the primary action (an email, a DB write). It swallows its own errors
// and returns a small result for logging.
//
// No secret required: Expo's push endpoint is unauthenticated for sending. If you
// later move to raw APNs/FCM, only this file changes.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export type PushInput = {
  title: string;
  body: string;
  // Deep-link + payload delivered to the app (e.g. { url: "aster://interview/123" }).
  data?: Record<string, unknown>;
  badge?: number;
};

// Send to every device registered for a single user. Returns counts for logging.
export async function pushToUser(
  admin: SupabaseClient,
  userId: string,
  msg: PushInput,
): Promise<{ sent: number; skipped: string | null }> {
  try {
    const { data: rows } = await admin
      .from("device_tokens")
      .select("token")
      .eq("user_id", userId);
    const tokens = (rows || []).map((r: { token: string }) => r.token).filter(Boolean);
    if (!tokens.length) return { sent: 0, skipped: "no_tokens" };

    const messages = tokens.map((to: string) => ({
      to,
      sound: "default",
      title: msg.title,
      body: msg.body,
      data: msg.data || {},
      ...(typeof msg.badge === "number" ? { badge: msg.badge } : {}),
    }));

    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });

    // Prune tokens Expo reports as unregistered so the table stays clean.
    if (res.ok) {
      const out = await res.json().catch(() => null);
      const receipts = out?.data;
      if (Array.isArray(receipts)) {
        const dead: string[] = [];
        receipts.forEach((r: { status?: string; details?: { error?: string } }, i: number) => {
          if (r?.status === "error" && r?.details?.error === "DeviceNotRegistered") dead.push(tokens[i]);
        });
        if (dead.length) await admin.from("device_tokens").delete().in("token", dead);
      }
    }
    return { sent: tokens.length, skipped: null };
  } catch (_e) {
    return { sent: 0, skipped: "error" };
  }
}

// Convenience for functions that only have SUPABASE_URL / service key in env.
export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

// Push the same message to every owner/admin of a company. The offer lifecycle
// (sent, signed, declined) is internal-to-the-team news, and the team is exactly
// this set. `exceptUserId` skips the person who triggered it, so the manager who
// clicked "send offer" isn't pinged about their own action.
// Best-effort like pushToUser: returns a count, never throws.
export async function pushToCompanyAdmins(
  admin: SupabaseClient,
  companyId: string,
  msg: PushInput,
  exceptUserId?: string,
): Promise<{ sent: number; recipients: number }> {
  try {
    const { data: rows } = await admin
      .from("profiles").select("id")
      .eq("company_id", companyId)
      .in("role", ["owner", "admin"])
      .eq("status", "active");
    const ids = (rows || [])
      .map((r: { id: string }) => r.id)
      .filter((id: string) => id && id !== exceptUserId);
    let sent = 0;
    for (const id of ids) { const r = await pushToUser(admin, id, msg); sent += r.sent; }
    return { sent, recipients: ids.length };
  } catch (_e) {
    return { sent: 0, recipients: 0 };
  }
}
