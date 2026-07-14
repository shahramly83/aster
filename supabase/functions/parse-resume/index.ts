// Supabase Edge Function: parse-resume
// ---------------------------------------------------------------------------
// Authenticated bulk resume import. A signed-in recruiter uploads a PDF (or
// Word doc converted to PDF) from the Bulk Resume Upload screen. This function
// reads it with Claude, extracts structured resume data, then (using the
// service role for the storage/DB writes, authorised by the caller's own
// company) stores the file in the private `resumes` bucket and creates or
// updates the candidate. Unlike parse-application it is NOT tied to a job and
// files no application, it just adds the person to the talent pool.
//
// Secrets required (set once):  ANTHROPIC_API_KEY
// Auto-provided by Supabase:     SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PARSE_MODEL = "claude-sonnet-5";           // web search does the company lookups
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
For each experience item, set "industry" to ONE concise, standard industry for that COMPANY, based on what the company itself mainly does. Examples: "Fintech", "Ride-hailing", "E-commerce", "SaaS", "Software Development", "Digital Agency", "Education", "Healthcare", "Government", "Consulting", "Manufacturing", "Media". Keep it to a short standard label (usually 1 to 3 words). NEVER combine two different industries into one label (no "X / Y" and no "X & Y"): if a company spans several, choose the single most representative one. Do NOT derive the industry from the candidate's job title or summary, those describe the person, not the company. If you don't already know the company (for example a small or local business), USE THE web_search TOOL to look up what that company does before deciding its industry. Only set "industry" to "Unknown" if a web search still doesn't reveal what the company does.
Set "is_resume" to true ONLY if the document is genuinely a person's resume / CV. For anything else (an invoice, essay, report, random document), set "is_resume" to false and leave the other fields null/empty. Use null or [] when a field is absent. Do not invent data. Keep summaries to one sentence.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// ---- profile-photo extraction helpers (same approach as parse-application) ----
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

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
        if (ar >= 0.3 && ar <= 3) out.push(img);
      }
      i = j;
    } else i++;
  }
  return out;
}

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
    // PDFs arrive as resume_base64 (Claude reads the PDF directly). Word docs
    // arrive as resume_text (the client extracts the text, since Claude can't
    // read a .docx binary).
    // `unreadable` marks a file the client couldn't turn into text (wrong type or
    // a Word doc it couldn't read). It still costs a credit (1 file = 1 credit)
    // but never hits the AI.
    const { resume_base64, resume_text, filename, unreadable } = await req.json();
    if (!resume_base64 && !resume_text && !unreadable) return json({ error: "resume_base64, resume_text or unreadable is required" }, 400);

    // --- Identify the caller and their company (this authorises the writes) ---
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: prof } = await admin
      .from("profiles").select("company_id").eq("id", user.id).maybeSingle();
    const companyId = prof?.company_id;
    if (!companyId) return json({ error: "no company for user" }, 403);

    // Spend one screening credit before the AI call: the monthly plan pool first,
    // then any purchased top-up balance (see migration 0086). This is atomic, so a
    // busy upload can't overspend, and a file that reaches the AI parse is charged
    // whatever the outcome (parsed, duplicate, or rejected), because the model was
    // billed to read it. If BOTH pools are empty, nothing is consumed and we block.
    // Fail-open on an RPC error so a counter hiccup never blocks a legitimate parse.
    const { data: consumeRows, error: consumeErr } = await admin.rpc("consume_resume_screen_for", { p_company: companyId });
    if (consumeErr) console.error("consume_resume_screen_for failed", consumeErr);
    const consumed = Array.isArray(consumeRows) ? consumeRows[0] : consumeRows;
    if (consumed && consumed.ok === false) {
      return json({ ok: false, error: "limit_reached", used: consumed.monthly_used ?? 0, limit: consumed.monthly_limit ?? null }, 200);
    }

    // Unreadable file: charged above, but there's nothing to parse. No AI call.
    if (unreadable) return json({ ok: false, error: "unreadable" }, 200);

    // --- Parse the PDF with Claude ---
    let parsed: Record<string, unknown> = {};
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("aster");
    if (!apiKey) return json({ error: "parser not configured" }, 503);

    const userContent = resume_text
      ? [{ type: "text", text: `RESUME TEXT (extracted from a Word document):\n\n${String(resume_text).slice(0, 60000)}\n\n---\n${EXTRACT_PROMPT}` }]
      : [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: resume_base64 } },
          { type: "text", text: EXTRACT_PROMPT },
        ];
    const baseBody = { model: PARSE_MODEL, max_tokens: 4000, messages: [{ role: "user", content: userContent }] };
    const callAnthropic = (withTools: boolean) => fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(withTools
        ? { ...baseBody, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }] }
        : baseBody),
    });

    let resp = await callAnthropic(true);
    if (!resp.ok) {
      console.error("anthropic (web search) error", resp.status, await resp.text());
      resp = await callAnthropic(false);
    }
    if (resp.ok) {
      const data = await resp.json();
      let text = (data.content || []).map((b: any) => (typeof b.text === "string" ? b.text : "")).join(" ").trim();
      text = text.replace(/```json/gi, "").replace(/```/g, "");
      const s = text.indexOf("{"), e = text.lastIndexOf("}");
      if (s >= 0 && e > s) {
        try { parsed = JSON.parse(text.slice(s, e + 1)); } catch (err) { console.error("json parse failed", err); }
      }
    } else {
      console.error("anthropic error", resp.status, await resp.text());
      return json({ error: "parse_failed" }, 502);
    }

    // Not a resume → nothing is created; caller marks the row rejected. Returned
    // as a 200 business outcome (not an HTTP error) so the client reads it off
    // `data` uniformly instead of unwrapping a FunctionsHttpError.
    if (parsed && parsed.is_resume === false) {
      return json({ ok: false, error: "not_a_resume" }, 200);
    }

    const fullName = (parsed.name as string) || "Unknown candidate";
    const finalEmail = ((parsed.email as string) || "").toLowerCase().trim() || null;

    // No email → we can't de-duplicate or contact them, so reject the resume
    // (nothing is created), matching the public apply flow.
    if (!finalEmail) {
      return json({ ok: false, error: "no_email" }, 200);
    }

    const experience = Array.isArray(parsed.experience) ? parsed.experience : [];
    const industries = [...new Set(
      experience
        .flatMap((e: any) => (e && e.industry ? String(e.industry).split("/") : []))
        .map((s: string) => s.trim())
        .filter((s: string) => s && !/^unknown$/i.test(s)),
    )];

    // Record any new industries in the company's taxonomy (so Skills & industry
    // search has options). Non-fatal if it fails.
    if (industries.length) {
      try {
        await admin.from("industries").upsert(
          industries.map((name) => ({ company_id: companyId, name, key: name.toLowerCase() })),
          { onConflict: "company_id,key", ignoreDuplicates: true },
        );
      } catch (e) {
        console.error("industry taxonomy upsert failed", e);
      }
    }

    const parsedOut = {
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

    // --- Upsert candidate (reuse by email within the company = de-dupe) ---
    let candidateId: string | null = null;
    let wasExisting = false;
    if (finalEmail) {
      const { data: existing } = await admin
        .from("candidates").select("id").eq("company_id", companyId).eq("email", finalEmail).maybeSingle();
      candidateId = existing?.id ?? null;
      wasExisting = !!candidateId;
    }
    const candidateRow = {
      company_id: companyId,
      full_name: fullName,
      email: finalEmail,
      phone: (parsed.phone as string) ?? null,
      location: (parsed.location as string) ?? null,
      summary: (parsed.summary as string) ?? null,
      years_experience: (parsed.years_of_experience as number) ?? null,
      skills: parsedOut.skills,
      file_name: filename ?? null,
      status: "parsed",
      has_photo: false,
      parsed: parsedOut,
    };
    if (candidateId) {
      await admin.from("candidates").update(candidateRow).eq("id", candidateId);
    } else {
      const { data: ins, error: insErr } = await admin
        .from("candidates").insert(candidateRow).select("id").single();
      if (insErr) { console.error("candidate insert failed", insErr); return json({ error: "could not save candidate" }, 500); }
      candidateId = ins.id;
    }

    // PDF path only: store the file privately and pull the applicant's photo.
    // Word docs come in as extracted text, so there's no PDF to store or scan.
    if (resume_base64) {
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

    return json({
      ok: true,
      candidate_id: candidateId,
      was_existing: wasExisting,
      person: { name: fullName, email: finalEmail, phone: parsedOut.phone },
    });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
