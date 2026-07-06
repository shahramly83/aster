// Supabase Edge Function: parse-application
// ---------------------------------------------------------------------------
// A public job applicant uploads a PDF resume. This function reads it with
// Claude, extracts structured resume data, then (using the service role, so it
// bypasses RLS in one controlled place) stores the PDF in the private `resumes`
// bucket and creates/updates the candidate + files an 'applied' application.
//
// Secrets required (set once):  ANTHROPIC_API_KEY
// Auto-provided by Supabase:     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-haiku-4-5-20251001"; // fast + cheap; bump to a Sonnet/Opus id for tougher resumes

const EXTRACT_PROMPT = `You are a resume parser. Read the attached PDF and return ONLY a JSON object (no markdown, no commentary) with exactly these keys:
{
  "is_resume": boolean,
  "name": string,
  "email": string | null,
  "phone": string | null,
  "location": string | null,
  "summary": string | null,
  "years_of_experience": number | null,
  "skills": string[],
  "languages": string[],
  "certifications": string[],
  "experience": [{ "title": string, "company": string, "duration": string, "summary": string }],
  "education": [{ "degree": string, "institution": string, "year": string }]
}
Set "is_resume" to true ONLY if the document is genuinely a person's resume / CV. For anything else (an invoice, essay, report, cover letter with no CV, random document), set "is_resume" to false and leave the other fields null/empty. Use null or [] when a field is absent. Do not invent data. Keep summaries to one sentence.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const { job_id, name, email, resume_base64, filename, source } = await req.json();
    if (!job_id || !resume_base64) return json({ error: "job_id and resume_base64 are required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // The job must exist and be open — this is the only thing that authorises
    // creating rows for its company.
    const { data: job, error: jobErr } = await admin
      .from("jobs").select("company_id, status").eq("id", job_id).maybeSingle();
    if (jobErr || !job) return json({ error: "job not found" }, 404);
    if (job.status !== "open") return json({ error: "job not open" }, 409);
    const companyId = job.company_id;

    // --- Parse the PDF with Claude ---
    // Accept the key under either secret name so an existing "aster" secret works.
    let parsed: Record<string, unknown> = {};
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("aster");
    if (apiKey) {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1500,
          messages: [{
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: resume_base64 } },
              { type: "text", text: EXTRACT_PROMPT },
            ],
          }],
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const text = (data.content || []).map((b: any) => b.text || "").join("").trim();
        const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
        try { parsed = JSON.parse(cleaned); } catch { /* keep {} on parse failure */ }
      } else {
        console.error("anthropic error", resp.status, await resp.text());
      }
    }

    // Reject files the AI judged not to be a resume — nothing is created.
    if (apiKey && parsed && parsed.is_resume === false) {
      return json({ error: "not_a_resume" }, 422);
    }

    const fullName = (parsed.name as string) || name || "New applicant";
    const finalEmail = ((parsed.email as string) || email || "").toLowerCase().trim() || null;

    // No email on the resume → we can't de-duplicate or contact them. Ask for one.
    if (apiKey && !finalEmail) {
      return json({ error: "no_email" }, 422);
    }

    parsed = {
      name: fullName,
      email: finalEmail,
      phone: (parsed.phone as string) ?? null,
      location: (parsed.location as string) ?? null,
      summary: (parsed.summary as string) ?? null,
      years_of_experience: (parsed.years_of_experience as number) ?? null,
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      languages: Array.isArray(parsed.languages) ? parsed.languages : [],
      certifications: Array.isArray(parsed.certifications) ? parsed.certifications : [],
      experience: Array.isArray(parsed.experience) ? parsed.experience : [],
      education: Array.isArray(parsed.education) ? parsed.education : [],
    };

    // --- Upsert candidate (reuse by email within the company) ---
    let candidateId: string | null = null;
    if (finalEmail) {
      const { data: existing } = await admin
        .from("candidates").select("id").eq("company_id", companyId).eq("email", finalEmail).maybeSingle();
      candidateId = existing?.id ?? null;
    }
    const candidateRow = {
      company_id: companyId,
      full_name: fullName,
      email: finalEmail,
      phone: (parsed.phone as string) ?? null,
      location: (parsed.location as string) ?? null,
      summary: (parsed.summary as string) ?? null,
      years_experience: (parsed.years_of_experience as number) ?? null,
      skills: parsed.skills,
      file_name: filename ?? null,
      status: "parsed",
      has_photo: false,
      parsed,
    };
    if (candidateId) {
      await admin.from("candidates").update(candidateRow).eq("id", candidateId);
    } else {
      const { data: ins, error: insErr } = await admin
        .from("candidates").insert(candidateRow).select("id").single();
      if (insErr) return json({ error: "could not save candidate" }, 500);
      candidateId = ins.id;
    }

    // --- Store the PDF privately at resumes/{company}/{candidate}.pdf ---
    try {
      const bytes = Uint8Array.from(atob(resume_base64), (c) => c.charCodeAt(0));
      const path = `${companyId}/${candidateId}.pdf`;
      await admin.storage.from("resumes").upload(path, bytes, { contentType: "application/pdf", upsert: true });
      await admin.from("candidates").update({ resume_path: path }).eq("id", candidateId);
    } catch (e) {
      console.error("resume upload failed", e); // non-fatal
    }

    // --- File the application (one per candidate per job) ---
    const { data: app } = await admin
      .from("applications").select("id").eq("company_id", companyId).eq("candidate_id", candidateId).eq("job_id", job_id).maybeSingle();
    if (!app) {
      await admin.from("applications").insert({
        company_id: companyId, candidate_id: candidateId, job_id,
        stage: "applied", source: (source || "Career Page"),
      });
    }

    return json({ ok: true, candidate_id: candidateId });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
