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

const PARSE_MODEL = "claude-sonnet-5";           // web search does the company lookups, so Sonnet is plenty (cheaper than Opus)
const FACE_MODEL = "claude-haiku-4-5-20251001";  // cheap vision, just to pick the headshot

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
  "experience": [{ "title": string, "company": string, "industry": string, "duration": string, "summary": string }],
  "education": [{ "degree": string, "institution": string, "year": string }]
}
For each experience item, set "industry" to the industry of that COMPANY, based on what the company itself actually does. Examples: "Fintech", "Ride-hailing", "E-commerce", "SaaS", "Education", "Healthcare", "Government", "Consulting", "Manufacturing", "Media". Do NOT derive the industry from the candidate's job title, responsibilities or summary — those describe the person's role, not the company's business. If you don't already know the company (for example a small or local business), USE THE web_search TOOL to look up what that company does before deciding its industry. Search each unfamiliar company by its full name. Only set "industry" to "Unknown" if a web search still doesn't reveal what the company does.
Set "is_resume" to true ONLY if the document is genuinely a person's resume / CV. For anything else (an invoice, essay, report, cover letter with no CV, random document), set "is_resume" to false and leave the other fields null/empty. Use null or [] when a field is absent. Do not invent data. Keep summaries to one sentence.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// ---- profile-photo extraction helpers ----
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

// Read a JPEG's pixel dimensions from its SOF marker; null if not a valid JPEG.
function jpegSize(b: Uint8Array): { w: number; h: number } | null {
  if (b[0] !== 0xFF || b[1] !== 0xD8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xFF) { i++; continue; }
    const m = b[i + 1];
    if ((m >= 0xC0 && m <= 0xC3) || (m >= 0xC5 && m <= 0xC7) || (m >= 0xC9 && m <= 0xCB) || (m >= 0xCD && m <= 0xCF)) {
      const h = (b[i + 5] << 8) | b[i + 6];
      const w = (b[i + 7] << 8) | b[i + 8];
      return { w, h };
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

// Pull embedded JPEG streams out of the raw PDF and keep photo-shaped ones.
function extractPhotos(bytes: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i + 3 < bytes.length && out.length < 8;) {
    if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8 && bytes[i + 2] === 0xFF) {
      let j = i + 3;
      for (; j + 1 < bytes.length; j++) if (bytes[j] === 0xFF && bytes[j + 1] === 0xD9) { j += 2; break; }
      const img = bytes.slice(i, j);
      const size = img.length > 3000 ? jpegSize(img) : null;
      if (size && size.w >= 60 && size.h >= 60 && size.w <= 5000 && size.h <= 5000) {
        const ar = size.w / size.h;
        if (ar >= 0.3 && ar <= 3) out.push(img); // skip banners/rules
      }
      i = j;
    } else i++;
  }
  return out;
}

// Ask the model which extracted image is the applicant's face; -1 if none.
async function pickFaceIndex(apiKey: string, imgs: Uint8Array[]): Promise<number> {
  if (!imgs.length) return -1;
  const content: unknown[] = imgs.map((img) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: toBase64(img) } }));
  content.push({ type: "text", text: `These images were extracted from a resume PDF, in order. Reply with ONLY JSON {"index": n}: n is the 0-based index of the image that is a photo of the applicant themselves (a person's face / headshot), or -1 if none is a person's photo. Ignore company logos, icons, charts and decorative graphics.` });
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: FACE_MODEL, max_tokens: 40, messages: [{ role: "user", content }] }),
    });
    if (!resp.ok) { console.error("face pick error", resp.status); return -1; }
    const data = await resp.json();
    const text = (data.content || []).map((b: any) => b.text || "").join("").trim();
    const j = JSON.parse(text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim());
    return typeof j.index === "number" ? j.index : -1;
  } catch (e) { console.error("face pick failed", e); return -1; }
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
      const baseBody = {
        model: PARSE_MODEL,
        max_tokens: 4000,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: resume_base64 } },
            { type: "text", text: EXTRACT_PROMPT },
          ],
        }],
      };
      const callAnthropic = (withTools: boolean) => fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify(withTools
          ? { ...baseBody, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }] }
          : baseBody),
      });

      // Try with web search; if the tool isn't available on the account, fall
      // back to a plain call so the parse still works.
      let resp = await callAnthropic(true);
      if (!resp.ok) {
        console.error("anthropic (web search) error", resp.status, await resp.text());
        resp = await callAnthropic(false);
      }
      if (resp.ok) {
        const data = await resp.json();
        // The model may narrate around its searches; pull the JSON object out.
        let text = (data.content || []).map((b: any) => (typeof b.text === "string" ? b.text : "")).join(" ").trim();
        text = text.replace(/```json/gi, "").replace(/```/g, "");
        const s = text.indexOf("{"), e = text.lastIndexOf("}");
        if (s >= 0 && e > s) {
          try { parsed = JSON.parse(text.slice(s, e + 1)); } catch (err) { console.error("json parse failed", err); }
        }
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

    const experience = Array.isArray(parsed.experience) ? parsed.experience : [];
    // Distinct industries across the roles (drop blanks / "Unknown").
    const industries = [...new Set(
      experience
        .map((e: any) => (e && e.industry ? String(e.industry).trim() : ""))
        .filter((s: string) => s && !/^unknown$/i.test(s))
    )];
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
      experience,
      education: Array.isArray(parsed.education) ? parsed.education : [],
      industries,
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

    const pdfBytes = Uint8Array.from(atob(resume_base64), (c) => c.charCodeAt(0));

    // --- Store the PDF privately at resumes/{company}/{candidate}.pdf ---
    try {
      const path = `${companyId}/${candidateId}.pdf`;
      await admin.storage.from("resumes").upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
      await admin.from("candidates").update({ resume_path: path }).eq("id", candidateId);
    } catch (e) {
      console.error("resume upload failed", e); // non-fatal
    }

    // --- Best-effort: pull the applicant's photo out of the resume ---
    if (apiKey) {
      try {
        const imgs = extractPhotos(pdfBytes);
        const idx = await pickFaceIndex(apiKey, imgs);
        if (idx >= 0 && imgs[idx]) {
          const photoPath = `${companyId}/${candidateId}_photo.jpg`;
          await admin.storage.from("resumes").upload(photoPath, imgs[idx], { contentType: "image/jpeg", upsert: true });
          await admin.from("candidates").update({ photo_path: photoPath, has_photo: true }).eq("id", candidateId);
        }
      } catch (e) {
        console.error("photo extract failed", e); // non-fatal
      }
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
