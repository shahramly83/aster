// Server-side AI credit metering.
// ---------------------------------------------------------------------------
// rank-candidates and analyze-experience used to verify the JWT and then call
// Anthropic, with the *browser* bumping the counter afterwards. Any signed-in
// user could invoke them directly, in a loop, for unlimited Claude spend on our
// bill. parse-resume was the only AI function that metered on the server.
//
// The credit must be taken BEFORE the model call, or the cap is unenforceable.
// If our call then fails, refund() puts it back — an outage on our side is not
// the customer's problem. The refund RPCs take a company id and hand credits
// back, so they are service_role only (see 0046); the charge RPCs take no
// parameter and resolve the company from the caller's own JWT.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type Meter = "ai_rank" | "ai_insight";

const BUMP: Record<Meter, string> = { ai_rank: "bump_ai_rank", ai_insight: "bump_ai_insight" };
const REFUND: Record<Meter, string> = { ai_rank: "refund_ai_rank_for", ai_insight: "refund_ai_insight_for" };

export interface Charge {
  ok: boolean;              // false = out of credits, caller must not call the model
  used?: number;
  limit?: number | null;
  resetsAt?: string | null;
  companyId?: string;
  error?: string;
}

/**
 * Consume one credit as the *caller*, so current_company_id() resolves from their
 * JWT and nobody can meter against another tenant. Atomic: bump_* takes a row
 * lock and refuses to increment past the cap, returning charged=false.
 */
export async function charge(token: string, meter: Meter): Promise<Charge> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await asUser.rpc(BUMP[meter]);
  if (error) {
    console.error(`${BUMP[meter]} failed`, error.message);
    // Fail CLOSED. A metering outage must not become a free-AI outage.
    return { ok: false, error: error.code === "42883" ? "metering_unavailable" : error.message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, error: "metering_unavailable" };
  if (!row.charged) return { ok: false, used: row.used, limit: row.monthly_limit, resetsAt: row.resets_at, error: "limit_reached" };

  // Resolve the company for a possible refund. Derived from the authenticated
  // user's own profile, never from the request body.
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: { user } } = await admin.auth.getUser(token);
  const { data: prof } = await admin.from("profiles").select("company_id").eq("id", user?.id ?? "").maybeSingle();

  return { ok: true, used: row.used, limit: row.monthly_limit, resetsAt: row.resets_at, companyId: prof?.company_id };
}

/** Give the credit back when *our* model call failed. Best effort. */
export async function refund(companyId: string | undefined, meter: Meter): Promise<void> {
  if (!companyId) return;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await admin.rpc(REFUND[meter], { p_company: companyId });
  if (error) console.error(`${REFUND[meter]} failed`, error.message);
}
