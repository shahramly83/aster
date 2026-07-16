// Supabase Edge Function: rank-candidates
// ---------------------------------------------------------------------------
// Given the skills/industries a recruiter searched for and a list of their own
// candidates, asks Claude (Sonnet) to rank them by fit and explain why. The
// candidate data is sent by the client (it's the company's own RLS-scoped data);
// this function only ranks what it's given — it reads nothing from the database.
// A valid signed-in user is required so it can't be used as an open Claude proxy.
//
// Secrets: ANTHROPIC_API_KEY (or "aster")   Auto: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chargeAiRankUnits, refundAiRankUnits } from "../_shared/meter.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODEL = "claude-sonnet-5";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    // Require a real signed-in user (not just the anon key).
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "unauthorized" }, 401);

    const { skills = [], industries = [], role = null, candidates = [], units: reqUnits } = await req.json();
    if (!Array.isArray(candidates) || candidates.length === 0) return json({ ranked: [] });

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("aster");
    if (!apiKey) return json({ error: "no_api_key" }, 500);

    // AI Rank is priced per N candidates: the client sends how many CREDITS this
    // run costs (it computed ceil(count/10) on the Applicants board, ceil(count/50)
    // in Candidate Search). Never trust it to be smaller than the batch implies —
    // clamp to at least 1 and never more than one credit per candidate.
    const units = Math.min(candidates.length, Math.max(1, Math.floor(Number(reqUnits) || 1)));

    // Take the credits before spending money. The browser used to do this after
    // the fact, so calling this function directly was free and unlimited.
    const paid = await chargeAiRankUnits(token, units);
    if (!paid.ok) {
      const status = paid.error === "limit_reached" ? 402 : 503;
      // `available` lets the client offer a partial run or a top-up.
      return json({ error: paid.error, available: paid.available, used: paid.used, monthly_limit: paid.limit, resets_at: paid.resetsAt }, status);
    }

    // Rank against a specific open role, or against loose skills/industry criteria.
    const criteria = (role && role.title)
      ? `the open role "${role.title}".
Role description: ${role.description || "(none given)"}
Key requirements: ${Array.isArray(role.requirements) && role.requirements.length ? role.requirements.join("; ") : "(none given)"}`
      : `this search.
Skills wanted: ${skills.length ? skills.join(", ") : "(none specified)"}
Industry wanted: ${industries.length ? industries.join(", ") : "(none specified)"}`;

    const prompt = `You are an expert technical recruiter. Rank the candidates below by how well they fit ${criteria}

Candidates (JSON):
${JSON.stringify(candidates)}

Score each candidate 0-100 for overall fit, weighing: how well their actual skills and job titles match what's needed, relevant industry experience, and seniority/years. A candidate from an unrelated field should score low even if they're strong in their own area. Be decisive and spread the scores out, so the clear best fit scores much higher than a weak one. In "reason", write two short, specific sentences a hiring manager can act on: name the concrete matching or missing skills and experience, and flag any standout or risk (over- or under-qualified, seniority gap, domain mismatch). Plain language, no vague filler, and do not use dashes. Return ONLY a JSON array, best fit first, no prose:
[{ "id": "<candidate id>", "score": <0-100 integer>, "reason": "<two concise, specific sentences>" }]`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
    });
    // Our failure, not theirs: hand the credit back.
    if (!resp.ok) { console.error("anthropic error", resp.status, await resp.text()); await refundAiRankUnits(paid.companyId, paid.monthlyCharged, paid.purchasedCharged); return json({ error: "rank_failed" }, 502); }
    const data = await resp.json();
    let text = (data.content || []).map((b: any) => (typeof b.text === "string" ? b.text : "")).join(" ").trim();
    text = text.replace(/```json/gi, "").replace(/```/g, "");
    const s = text.indexOf("["), e = text.lastIndexOf("]");
    let ranked: unknown = [];
    if (s >= 0 && e > s) { try { ranked = JSON.parse(text.slice(s, e + 1)); } catch (err) { console.error("json parse", err); } }
    if (!Array.isArray(ranked)) ranked = [];

    // Keep only ids we were given; clamp scores.
    const allowed = new Set((candidates as any[]).map((c) => c.id));
    ranked = (ranked as any[])
      .filter((r) => r && allowed.has(r.id))
      .map((r) => ({ id: r.id, score: Math.max(0, Math.min(100, Math.round(Number(r.score) || 0))), reason: String(r.reason || "").slice(0, 400) }));

    return json({ ranked, used: paid.used, monthly_limit: paid.limit, resets_at: paid.resetsAt });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected" }, 500);
  }
});
