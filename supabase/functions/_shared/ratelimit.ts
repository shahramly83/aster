// Shared per-key rate limiter for PUBLIC edge functions.
// ---------------------------------------------------------------------------
// Primary limiter is Postgres (chat_rate_hit, migration 0017): atomic and shared
// across every load-balanced isolate, so an in-memory map alone would not hold.
//
// The important difference from a naive limiter: if the database is unreachable
// we DO NOT fail open. A public, AI-backed endpoint left unthrottled during a DB
// blip is a real spend/abuse vector (each parse-application call fans out to
// several paid Claude calls). Instead we fall back to a per-isolate in-memory
// counter — a database outage degrades to a tighter LOCAL cap, never to unlimited
// access. The effective ceiling during an outage is fallbackMax × (live isolates),
// which is bounded, versus infinity for fail-open.
//
// Callers pass the service role via the ambient SUPABASE_SERVICE_ROLE_KEY env.

type MemBucket = { bucket: number; count: number };
const mem = new Map<string, MemBucket>();

// Returns true/false from Postgres, or null when the DB could not be consulted
// (no creds, RPC missing, or a network error) so the caller uses the fallback.
async function dbAllow(key: string, max: number, windowSeconds: number): Promise<boolean | null> {
  const surl = Deno.env.get("SUPABASE_URL");
  const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!surl || !srk) return null;
  try {
    const r = await fetch(`${surl}/rest/v1/rpc/chat_rate_hit`, {
      method: "POST",
      headers: { apikey: srk, Authorization: `Bearer ${srk}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_key: key, p_max: max, p_window_seconds: windowSeconds }),
    });
    if (!r.ok) return null;                 // RPC not deployed / errored -> fallback (NOT fail open)
    return (await r.json()) !== false;
  } catch {
    return null;                            // network / DB hiccup -> fallback
  }
}

// Per-isolate fixed-window counter. Only exercised while the DB is unreachable.
function memAllow(key: string, max: number, windowSeconds: number): boolean {
  const b = Math.floor(Date.now() / 1000 / Math.max(windowSeconds, 1));
  const cur = mem.get(key);
  if (!cur || cur.bucket !== b) {
    mem.set(key, { bucket: b, count: 1 });
    if (mem.size > 5000) { for (const [k, v] of mem) if (v.bucket < b - 2) mem.delete(k); } // keep the map small
    return 1 <= max;
  }
  cur.count += 1;
  return cur.count <= max;
}

/**
 * True when the request is within the limit. Consumes one unit of the caller's
 * quota. On a database failure this falls back to a stricter per-isolate limit
 * (fallbackMax, default half of max) rather than failing open.
 */
export async function rateLimit(
  key: string,
  max: number,
  windowSeconds: number,
  fallbackMax: number = Math.max(1, Math.floor(max / 2)),
): Promise<boolean> {
  const db = await dbAllow(key, max, windowSeconds);
  if (db !== null) return db;
  return memAllow(key, fallbackMax, windowSeconds);
}

// Best-effort client IP from the standard proxy header. "unknown" groups all
// header-less callers into one bucket, which is the safe (stricter) default.
export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}
