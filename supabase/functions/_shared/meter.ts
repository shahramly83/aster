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

export type Meter = "ai_rank" | "ai_insight" | "interview_questions" | "see_why";

// ai_rank supports purchased top-up credits: consume_ai_rank spends the monthly
// pool first, then any purchased 'ai_rank' balance, and reports which via `source`.
// The other meters have no top-up yet and use the plain bump/refund pair.
const BUMP: Record<Meter, string> = { ai_rank: "consume_ai_rank", ai_insight: "bump_ai_insight", interview_questions: "bump_interview_questions", see_why: "bump_see_why" };
const REFUND: Record<Meter, string> = { ai_rank: "refund_ai_rank_for", ai_insight: "refund_ai_insight_for", interview_questions: "refund_interview_questions_for", see_why: "refund_see_why_for" };
// Which purchased credit kind backs each meter (only ai_rank, for now).
const PURCHASED_KIND: Partial<Record<Meter, string>> = { ai_rank: "ai_rank" };

export interface Charge {
  ok: boolean;              // false = out of credits, caller must not call the model
  used?: number;
  limit?: number | null;
  resetsAt?: string | null;
  companyId?: string;
  source?: string;          // 'monthly' | 'purchased' — which pool paid (for the refund)
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

  return { ok: true, used: row.used, limit: row.monthly_limit, resetsAt: row.resets_at, companyId: prof?.company_id, source: row.source };
}

/**
 * Give the credit back when *our* model call failed. Best effort. Refunds the
 * pool that actually paid: a purchased credit goes back to the purchased balance,
 * a monthly credit to the monthly counter.
 */
export async function refund(companyId: string | undefined, meter: Meter, source?: string): Promise<void> {
  if (!companyId) return;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const kind = PURCHASED_KIND[meter];
  if (source === "purchased" && kind) {
    const { error } = await admin.rpc("refund_purchased_credit", { p_company: companyId, p_kind: kind });
    if (error) console.error("refund_purchased_credit failed", error.message);
    return;
  }
  const { error } = await admin.rpc(REFUND[meter], { p_company: companyId });
  if (error) console.error(`${REFUND[meter]} failed`, error.message);
}
