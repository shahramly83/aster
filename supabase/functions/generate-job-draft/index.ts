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
  "employment_type": "full_time" | "part_time" | "contract" | "internship",
  "work_mode": "onsite" | "hybrid" | "remote",
  "seniority": one of ["junior","mid","senior","lead","principal"],
  "key_skills": string[],  // 6 to 10, the specific things you would rank a CV against
  "salary_min": number,    // whole units of the given currency, per month
  "salary_max": number,
  "salary_note": string,   // one short line saying what the range is based on
  "description": string,   // see the description rules below. THIS IS THE FIELD MOST OFTEN GOT WRONG.
  "responsibilities": string[],  // 4 to 6, one short line each, what this person actually does day to day
  "requirements": string[],      // 4 to 6, one short line each, what a candidate must have to be considered
  "benefits": string[],          // 3 to 5, one short line each. See the benefits rule below.
  "assumption": string           // "" unless the title was ambiguous. If it was, ONE short line naming the reading you chose. This is shown to the hiring manager on its own, so it must NOT appear in the description.
}

DESCRIPTION RULES. This field sits above separate fields for responsibilities, requirements and benefits, so anything that belongs in those is duplication:
- Plain prose. Two short paragraphs, 60 to 110 words in total.
- NO markdown. No "##" headings, no "**bold**", no bullet points, no dashes starting a line. Headings and bullets in this field are the single most common failure.
- Do NOT list what the person will do, what is required, or what is nice to have. Those are three other fields.
- Do NOT explain your own reasoning, your interpretation of the title, or what the posting is for. Never begin with "This posting is", "This role is for", "This description covers". Put any interpretation in "assumption" instead.
- Say what the team does, what the person joining will own, and why the job matters. Address the candidate as "you". Write as the company, using "we".
- Do not end with process notes like "Applications are reviewed on a rolling basis".

BANNED WRITING. These read as machine-written and must not appear anywhere:
- Em dashes. Use a comma, a colon, a full stop or brackets. This is a hard rule.
- "rockstar", "ninja", "guru", "wear many hats", "hit the ground running", "fast-paced environment", "dynamic team", "we are seeking a", "the ideal candidate will", "passionate about", "synergy", "leverage" as a verb.
- Emoji.

OTHER RULES:
- Use the exact lowercase token values given above for employment_type, work_mode and seniority. Not "Full-time", not "On-site".
- Write for the country and city given. Salary must be a realistic MONTHLY range for that market and seniority, in the currency given, not a US figure converted.
- key_skills are things a resume can be matched against: tools, languages, domains. Not "communication" or "team player".
- responsibilities and requirements are safe to infer from the role: they describe the job being advertised.
- benefits are DIFFERENT and need care, because a posting is a public promise the company has to keep. Write only what is statutory or near-universal for the stated country (in Malaysia: EPF and SOCSO contributions, annual leave, medical coverage). Never invent an office perk, a bonus, a stock grant, a gym, free food, or a number of remote days. If you cannot name something safe for that market, return fewer items or an empty list.`;

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
          model, max_tokens: 4000,
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
    const blocks = Array.isArray(data?.content) ? data.content : [];
    // NOT content[0].text. Opus can put a thinking block first, in which case
    // block 0 has no .text at all and we were parsing an empty string while the
    // actual posting sat in block 1. Take every text block and ignore the rest.
    const text = blocks
      .filter((b: { type?: string }) => b?.type === "text")
      .map((b: { text?: string }) => b?.text || "")
      .join(" ")
      .trim();

    // The model is told to return only JSON, but a stray sentence either side
    // should cost the customer nothing: pull the object out rather than failing.
    const match = text.match(/\{[\s\S]*\}/);
    let draft: Record<string, unknown> | null = null;
    try { draft = match ? JSON.parse(match[0]) : null; } catch { draft = null; }
    if (!draft || !draft.description) {
      await refund(paid.companyId, "job_draft", paid.source);
      // Name the shape of what came back. "Not usable" on its own left the last
      // round of this bug undiagnosable without function logs, which the CLI
      // cannot read.
      const shape = blocks.map((b: { type?: string }) => b?.type || "?").join("+") || "empty";
      console.error("unparseable draft", data?.stop_reason, shape, text.slice(0, 600));
      const why = data?.stop_reason === "max_tokens"
        ? "the posting was cut off before it finished"
        : `the reply was ${shape}, ${text.length} chars, stop=${data?.stop_reason ?? "?"}`;
      return json({ error: "generate_failed", detail: why }, 502);
    }

    if (typeof draft.description === "string") {
      draft.description = draft.description
        .replace(/^#{1,6}\s*/gm, "")        // "## About the role" -> "About the role"
        .replace(/^\s*[-*+]\s+/gm, "")      // stray bullet lines
        .replace(/\*\*(.+?)\*\*/g, "$1")    // bold
        .replace(/\u2014/g, ", ")           // em dash, banned in Aster copy
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
    return json({ ok: true, draft, currency: context.currency, assumption: draft.assumption || "" });
  } catch (e) {
    console.error("generate-job-draft", e);
    return json({ error: "generate_failed" }, 500);
  }
});
