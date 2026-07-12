// Supabase Edge Function: see-why
// ---------------------------------------------------------------------------
// A dedicated, on-demand AI explanation of why ONE candidate fits (or doesn't
// fit) a specific role. Distinct from AI Rank: Rank scores the whole list; this
// writes a short, honest, candidate-specific rationale a reviewer can act on.
// The company sends its own RLS-scoped candidate data; nothing is read from the
// DB. Metered server-side (see_why credit) and requires a signed-in user.
//
// Secrets: ANTHROPIC_API_KEY (or "aster")   Auto: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { charge, refund } from "../_shared/meter.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODEL = "claude-haiku-4-5-20251001";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const PROMPT = `You are a hiring manager explaining, in plain language, why a specific candidate does or does not fit a specific role. Read the resume and the role below and write ONE short paragraph (2 to 3 sentences, max ~55 words). Be concrete: name the actual skills, employers or gaps that matter for THIS role. Be honest, not a sales pitch: if the fit is weak, say what's missing. No preamble, no bullet points, no markdown.

Return ONLY a JSON object, nothing else:
{ "explanation": string }`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "unauthorized" }, 401);

    const { candidate = null, role = {} } = await req.json();
    const parsed = candidate?.parsed ?? candidate;
    if (!parsed || typeof parsed !== "object") return json({ error: "no_candidate" }, 400);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("aster");
    if (!apiKey) return json({ error: "no_api_key" }, 500);

    const paid = await charge(token, "see_why");
    if (!paid.ok) {
      const status = paid.error === "limit_reached" ? 402 : 503;
      return json({ error: paid.error, used: paid.used, monthly_limit: paid.limit, resets_at: paid.resetsAt }, status);
    }

    const resume = {
      name: parsed.name ?? null,
      summary: parsed.summary ?? null,
      skills: Array.isArray(parsed.skills) ? parsed.skills.slice(0, 25) : [],
      experience: Array.isArray(parsed.experience)
        ? parsed.experience.slice(0, 5).map((e: any) => ({ title: e?.title ?? null, company: e?.company ?? null, duration: e?.duration ?? null }))
        : [],
    };
    const roleInfo = {
      title: typeof role?.title === "string" ? role.title.slice(0, 120) : "the role",
      skills: Array.isArray(role?.skills) ? role.skills.slice(0, 20) : [],
      requirements: Array.isArray(role?.requirements) ? role.requirements.slice(0, 12) : (typeof role?.requirements === "string" ? role.requirements.slice(0, 800) : []),
      seniority: role?.seniority_level ?? role?.seniority ?? null,
    };

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [{ role: "user", content: `${PROMPT}\n\nRole (JSON):\n${JSON.stringify(roleInfo)}\n\nResume (JSON):\n${JSON.stringify(resume)}` }] }),
    });
    if (!resp.ok) { console.error("anthropic error", resp.status, await resp.text()); await refund(paid.companyId, "see_why"); return json({ error: "explain_failed" }, 502); }
    const data = await resp.json();
    let text = (data.content || []).map((b: any) => (typeof b.text === "string" ? b.text : "")).join(" ").trim();
    text = text.replace(/```json/gi, "").replace(/```/g, "");
    const s = text.indexOf("{"), e = text.lastIndexOf("}");
    let raw: any = null;
    if (s >= 0 && e > s) { try { raw = JSON.parse(text.slice(s, e + 1)); } catch (err) { console.error("json parse", err); } }
    const explanation = raw && typeof raw.explanation === "string" ? raw.explanation.trim().slice(0, 600) : "";
    if (!explanation) { await refund(paid.companyId, "see_why"); return json({ error: "explain_failed" }, 502); }

    return json({ explanation, used: paid.used, monthly_limit: paid.limit, resets_at: paid.resetsAt });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected" }, 500);
  }
});
