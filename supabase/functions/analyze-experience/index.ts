// Supabase Edge Function: analyze-experience
// ---------------------------------------------------------------------------
// Given one candidate's already-parsed resume (sent by the client — it's the
// company's own RLS-scoped data), asks Claude (Haiku) for a deeper "AI
// Experience Insights" read: total and leadership experience, domain exposure,
// employer tenure, career progression, and any employment gaps. This function
// only analyses what it's given — it reads nothing from the database. A valid
// signed-in user is required so it can't be used as an open Claude proxy.
//
// Secrets: ANTHROPIC_API_KEY (or "aster")   Auto: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODEL = "claude-haiku-4-5-20251001"; // fast + cheap; the read is a bounded analysis, not open-ended reasoning
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const PROMPT = `You are an expert technical recruiter reading one candidate's resume. Analyse ONLY the resume below and return a deep, honest read of their experience. Base every number on what the resume actually shows — do not inflate. If something can't be determined, use a sensible conservative value (0, null, or an empty array), never a guess.

Return ONLY a JSON object (no markdown, no commentary) with EXACTLY this shape:
{
  "experience_insights": {
    "total_experience_years": number,              // total professional years, one decimal ok
    "leadership_experience_years": number,         // years in lead/manager/head/principal/founder roles (0 if none)
    "domain_experience": [                          // up to 3, most years first; short domain labels like "Fintech", "E-commerce"
      { "domain": string, "years": number }
    ],
    "startup_experience": boolean,                 // worked at an early-stage / startup employer
    "enterprise_experience": boolean,              // worked at a large / enterprise employer
    "remote_work_mentioned": boolean               // resume mentions remote / distributed / hybrid work
  },
  "employment_analysis": {
    "number_of_employers": number,                 // distinct employers
    "average_tenure_months": number | null,        // mean months per role, rounded
    "longest_tenure": { "company": string, "months": number } | null,
    "career_progression": string,                  // one concise, specific sentence naming real roles/companies
    "employment_gaps": [                            // gaps of 3+ months between roles; empty array if none
      { "start": string, "end": string, "duration_months": number }
    ]
  }
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    // Require a real signed-in user (not just the anon key).
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "unauthorized" }, 401);

    const { candidate = null } = await req.json();
    const parsed = candidate?.parsed ?? candidate;
    if (!parsed || typeof parsed !== "object") return json({ error: "no_candidate" }, 400);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("aster");
    if (!apiKey) return json({ error: "no_api_key" }, 500);

    // Send only the fields the analysis needs — keep the payload lean.
    const resume = {
      name: parsed.name ?? null,
      location: parsed.location ?? null,
      years_of_experience: parsed.years_of_experience ?? null,
      summary: parsed.summary ?? null,
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      experience: Array.isArray(parsed.experience)
        ? parsed.experience.map((e: any) => ({ title: e?.title ?? null, company: e?.company ?? null, duration: e?.duration ?? null, industry: e?.industry ?? null, summary: e?.summary ?? null }))
        : [],
      education: Array.isArray(parsed.education) ? parsed.education : [],
    };

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1200, messages: [{ role: "user", content: `${PROMPT}\n\nResume (JSON):\n${JSON.stringify(resume)}` }] }),
    });
    if (!resp.ok) { console.error("anthropic error", resp.status, await resp.text()); return json({ error: "analyze_failed" }, 502); }
    const data = await resp.json();
    let text = (data.content || []).map((b: any) => (typeof b.text === "string" ? b.text : "")).join(" ").trim();
    text = text.replace(/```json/gi, "").replace(/```/g, "");
    const s = text.indexOf("{"), e = text.lastIndexOf("}");
    let raw: any = null;
    if (s >= 0 && e > s) { try { raw = JSON.parse(text.slice(s, e + 1)); } catch (err) { console.error("json parse", err); } }
    if (!raw || typeof raw !== "object") return json({ error: "analyze_failed" }, 502);

    // Normalise/clamp into the exact shape the UI renders, so a stray model
    // field or missing key can never break InsightsDisplay.
    const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
    const ei = raw.experience_insights || {};
    const ea = raw.employment_analysis || {};
    const insights = {
      generated_at: new Date().toISOString(),
      experience_insights: {
        total_experience_years: Math.max(0, num(ei.total_experience_years)),
        leadership_experience_years: Math.max(0, num(ei.leadership_experience_years)),
        domain_experience: (Array.isArray(ei.domain_experience) ? ei.domain_experience : [])
          .filter((d: any) => d && d.domain && num(d.years) > 0)
          .map((d: any) => ({ domain: String(d.domain).slice(0, 40), years: Math.max(0, num(d.years)) }))
          .slice(0, 3),
        startup_experience: Boolean(ei.startup_experience),
        enterprise_experience: Boolean(ei.enterprise_experience),
        remote_work_mentioned: Boolean(ei.remote_work_mentioned),
      },
      employment_analysis: {
        number_of_employers: Math.max(0, Math.round(num(ea.number_of_employers))),
        average_tenure_months: ea.average_tenure_months == null ? null : Math.max(0, Math.round(num(ea.average_tenure_months))),
        longest_tenure: ea.longest_tenure && ea.longest_tenure.company
          ? { company: String(ea.longest_tenure.company).slice(0, 80), months: Math.max(0, Math.round(num(ea.longest_tenure.months))) }
          : null,
        career_progression: String(ea.career_progression || "").slice(0, 400),
        employment_gaps: (Array.isArray(ea.employment_gaps) ? ea.employment_gaps : [])
          .filter((g: any) => g && g.start && g.end)
          .map((g: any) => ({ start: String(g.start).slice(0, 20), end: String(g.end).slice(0, 20), duration_months: Math.max(0, Math.round(num(g.duration_months))) })),
      },
    };

    return json({ insights });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected" }, 500);
  }
});
