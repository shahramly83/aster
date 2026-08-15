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
import { chargeAiRankUnits, refundAiRankUnits, logSpend } from "../_shared/meter.ts";
import { stripDashes } from "../_shared/text.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODEL = "claude-sonnet-5";
// 50 candidates x two sentences of reasoning needs well over the 4000 this used
// to allow. Sonnet 5 also thinks by default when `thinking` is unset (a change
// from 4.6), and thinking counts against max_tokens, so most of the old budget
// went on reasoning and the JSON array came back cut in half. Scoring a skills
// list is not work that needs a thinking pass; turning it off halves the token
// bill and leaves the whole budget for the answer. If the scores ever look
// shallow, swap this for output_config: { effort: "low" } rather than raising it.
const MAX_TOKENS = 8000;
const THINKING = { type: "disabled" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// Pull whole {...} objects out of a possibly truncated JSON array. Brace counting
// with string awareness, so a "}" inside a reason sentence doesn't close an
// object early. A cut-off response used to parse to nothing, which cost the
// caller the whole batch; salvaging the objects that did arrive intact loses at
// most the last candidate instead.
function salvageObjects(src: string): any[] {
  const out: any[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") { if (depth === 0) start = i; depth++; continue; }
    if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        try { out.push(JSON.parse(src.slice(start, i + 1))); } catch { /* partial object, drop it */ }
        start = -1;
      }
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    // Require a real signed-in user (not just the anon key).
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "unauthorized" }, 401);

    const { skills = [], industries = [], role = null, candidates = [], perUnit: reqPerUnit } = await req.json();
    if (!Array.isArray(candidates) || candidates.length === 0) return json({ ranked: [] });

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("aster");
    if (!apiKey) return json({ error: "no_api_key" }, 500);

    // AI Rank is priced per N candidates. Compute the credit count SERVER-SIDE
    // from the batch size so a caller can't underpay by sending a small `units`.
    // The client only tells us its pricing tier: 10 candidates/credit on the
    // Applicants board, 50/credit in Candidate Search. Unknown/absent → the
    // stricter 10 (never cheaper than the client could legitimately claim).
    const perUnit = Number(reqPerUnit) === 50 ? 50 : 10;
    const units = Math.max(1, Math.ceil(candidates.length / perUnit));

    // Take the credits before spending money. The browser used to do this after
    // the fact, so calling this function directly was free and unlimited.
    const paid = await chargeAiRankUnits(token, units);
    if (!paid.ok) {
      const status = paid.error === "limit_reached" ? 402 : 503;
      // `available` lets the client offer a partial run or a top-up.
      return json({ error: paid.error, available: paid.available, used: paid.used, monthly_limit: paid.limit, resets_at: paid.resetsAt }, status);
    }
    // What the credits bought (0143), while the role and the pool size are still
    // in hand: a bare "3 AI Rank credits used" tells nobody which run that was.
    await logSpend({
      companyId: paid.companyId,
      kind: "ai_rank",
      quantity: units,
      pool: paid.source ?? null,
      label: role?.title
        ? `AI Rank against ${role.title}`
        : "AI Rank against your search criteria",
      detail: `${candidates.length} candidate${candidates.length === 1 ? "" : "s"} scored, ${perUnit} per credit`,
    });

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
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, thinking: THINKING, messages: [{ role: "user", content: prompt }] }),
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
    // Nothing parsed cleanly (truncated array, stray prose): take whatever whole
    // objects the text does contain before writing the batch off.
    if ((ranked as any[]).length === 0 && s >= 0) {
      ranked = salvageObjects(text.slice(s));
      if ((ranked as any[]).length > 0) console.warn("salvaged", (ranked as any[]).length, "of", candidates.length);
    }

    // Keep only ids we were given; clamp scores.
    const allowed = new Set((candidates as any[]).map((c) => c.id));
    ranked = (ranked as any[])
      .filter((r) => r && allowed.has(r.id))
      .map((r) => ({ id: r.id, score: Math.max(0, Math.min(100, Math.round(Number(r.score) || 0))), reason: stripDashes(r.reason).slice(0, 400) }));

    // Nothing usable came back (empty/garbled model output) — the run produced no
    // ranking, so hand the credits back rather than charging for a blank result.
    if ((ranked as any[]).length === 0) {
      await refundAiRankUnits(paid.companyId, paid.monthlyCharged, paid.purchasedCharged);
      return json({ ranked: [], used: Math.max(0, (paid.used || 0) - (paid.monthlyCharged || 0)), monthly_limit: paid.limit, resets_at: paid.resetsAt });
    }

    return json({ ranked, used: paid.used, monthly_limit: paid.limit, resets_at: paid.resetsAt });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected" }, 500);
  }
});
