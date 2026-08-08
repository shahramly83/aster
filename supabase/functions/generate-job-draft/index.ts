// Supabase Edge Function: generate-job-draft
// ---------------------------------------------------------------------------
// Writes a whole job posting from its title, so a hiring manager starts from a
// draft to correct rather than an empty form.
//
// Opus, not the Haiku the other AI features run on. This is the only one whose
// output is customer-facing prose that goes out under the company's name on a
// public page, and it is charged accordingly: sold only as a top-up credit,
// with no monthly allowance on any plan (0170).
//
// Charged BEFORE the model call and refunded if our call fails, the same order
// as generate-interview-questions: a credit taken for nothing is worse than a
// call we swallow the cost of.
//
// Returns a draft for the form to fill in. Nothing is saved: the person still
// reviews every field and presses Create.
//
// Secrets: ANTHROPIC_API_KEY, and the meter's service-role access
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { charge, refund, logSpend } from "../_shared/meter.ts";

// Opus first, Sonnet behind it. Opus is what this feature is sold on, but it is
// the ONLY call in the whole product that uses it, so it is also the only one
// whose model access, rate limit or spend cap can be wrong without anything else
// breaking, and the customer has already paid a credit by the time we find out.
// Falling back beats refunding: a Sonnet posting is a good posting, and
// rank-candidates and parse-resume have both run on Sonnet here for months.
const MODELS = ["claude-opus-5", "claude-sonnet-5"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// Salary is included at Shah's direction. The prompt is explicit that it is a
// market estimate for the stated location, because a range that is quietly
// wrong is the one field on this form that costs real money once the posting is
// public. The UI labels it as an estimate for the same reason.
const PROMPT = `You write job postings for a recruitment product. Given a role title and a company's context, produce a complete, accurate, ready-to-review draft.

Return ONLY a JSON object, no prose around it, with exactly these keys:
{
  "department": string,
  "location": string,
  "employment_type": "Full-time" | "Part-time" | "Contract" | "Internship" | "Temporary",
  "work_mode": "On-site" | "Hybrid" | "Remote",
  "seniority": one of ["Junior","Mid","Senior","Lead","Principal"],
  "key_skills": string[]  // 6 to 10, the specific things you would rank a CV against
  "salary_min": number,   // whole units of the given currency, per month
  "salary_max": number,
  "salary_note": string,  // one short line saying what the range is based on
  "description": string   // markdown: what the role is, what they will do, what is required, what is nice to have
}

Rules:
- Write for the country and city given. Salary must be a realistic MONTHLY range for that market and seniority, in the currency given, not a US figure converted.
- If the title is vague, choose the most common reading and say so in the first line of the description.
- key_skills are things a resume can be matched against: tools, languages, domains. Not "communication" or "team player".
- description is 150 to 300 words. No emoji. No "rockstar", "ninja", "wear many hats".
- Never invent a company benefit, an office perk, or a legal entitlement you were not given.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    // Bare token, no "Bearer " prefix: charge() adds it. Passing the whole
    // header produced "Bearer Bearer eyJ..." and every draft died on "JWT
    // cryptographic operation failed" before it reached the model.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const title = String(body?.title || "").trim().slice(0, 120);
    if (!title) return json({ error: "no_title" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: prof } = await admin.from("profiles").select("company_id, role").eq("id", user.id).maybeSingle();
    if (!prof?.company_id) return json({ error: "no company for user" }, 403);
    if (!["owner", "admin"].includes(prof.role || "")) {
      return json({ error: "Only an owner or hiring manager can draft a job." }, 403);
    }

    const { data: co } = await admin
      .from("companies").select("name, address_city, address_country, preferred_currency")
      .eq("id", prof.company_id).maybeSingle();

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("aster");
    if (!apiKey) return json({ error: "no_api_key" }, 500);

    // Charge first, refund below if the model call fails.
    const paid = await charge(token, "job_draft");
    if (!paid.ok) {
      // No monthly pool exists for this kind, so "limit_reached" here always
      // means "no purchased credits left". Say that, not "you hit your limit".
      const status = paid.error === "limit_reached" ? 402 : 503;
      return json({ error: paid.error === "limit_reached" ? "no_credits" : paid.error }, status);
    }
    await logSpend({
      companyId: paid.companyId, kind: "job_draft", pool: paid.source ?? null,
      label: `AI job draft: ${title}`,
    });

    const context = {
      company: co?.name ?? null,
      city: co?.address_city ?? null,
      country: co?.address_country ?? null,
      currency: String(co?.preferred_currency || "myr").toUpperCase(),
      requested_location: String(body?.location || "").slice(0, 80) || null,
    };

    // Try each model in turn, keeping the last failure so the customer is told
    // what actually went wrong rather than "it didn't come back".
    let resp: Response | null = null;
    let lastDetail = "";
    let lastStatus = 0;
    for (const model of MODELS) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({
          model, max_tokens: 2000,
          messages: [{ role: "user", content: `${PROMPT}

Role title: ${title}

Company context (JSON):
${JSON.stringify(context)}` }],
        }),
      });
      if (r.ok) { resp = r; break; }
      const errBody = await r.text();
      lastStatus = r.status;
      lastDetail = errBody.slice(0, 300);
      try { lastDetail = JSON.parse(errBody)?.error?.message ?? lastDetail; } catch { /* not JSON */ }
      // Logged per model so the failing one is named, not just the last.
      console.error("anthropic error", model, r.status, errBody);
    }
    if (!resp) {
      // Every model refused, so this is ours to eat. Give the credit back.
      await refund(paid.companyId, "job_draft", paid.source);
      return json({ error: "generate_failed", detail: lastDetail, status: lastStatus }, 502);
    }

    const data = await resp.json();
    const text = data?.content?.[0]?.text ?? "";
    // The model is told to return only JSON, but a stray sentence either side
    // should cost the customer nothing: pull the object out rather than failing.
    const match = text.match(/\{[\s\S]*\}/);
    let draft: Record<string, unknown> | null = null;
    try { draft = match ? JSON.parse(match[0]) : null; } catch { draft = null; }
    if (!draft || !draft.description) {
      await refund(paid.companyId, "job_draft", paid.source);
      console.error("unparseable draft", text.slice(0, 400));
      return json({ error: "generate_failed", detail: "the model replied but not with a usable posting" }, 502);
    }

    return json({ ok: true, draft, currency: context.currency });
  } catch (e) {
    console.error("generate-job-draft", e);
    return json({ error: "generate_failed" }, 500);
  }
});
