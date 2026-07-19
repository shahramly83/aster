// Supabase Edge Function: generate-interview-questions
// ---------------------------------------------------------------------------
// Given one candidate's parsed resume (the company's own RLS-scoped data, sent
// by the client) and the role title, asks Claude for a set of interview
// questions tailored to THIS candidate and role. Replaces the client-side
// template generator. Metered server-side (interview_questions credit) so it
// can't be looped for free Claude spend; a real signed-in user is required.
//
// Secrets: ANTHROPIC_API_KEY (or "aster")   Auto: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { charge, refund } from "../_shared/meter.ts";
import { stripDashes } from "../_shared/text.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODEL = "claude-haiku-4-5-20251001";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const CATEGORIES = ["Technical", "Experience", "Role fit", "Behavioral", "Depth check", "Collaboration", "Motivation"];

const PROMPT = `You are an expert interviewer preparing to interview ONE candidate for a specific role. Using the candidate's resume and the role title below, write interview questions tailored to THIS person: reference their actual skills, employers and projects where useful, and probe the gaps between their background and the role. Do not ask generic questions that would suit any candidate.

Rules:
- Write EXACTLY 15 questions.
- Each question names or draws on something concrete from the resume OR the role when possible.
- Each "category" MUST be one of: ${CATEGORIES.join(", ")}.
- Keep each question to one or two sentences.
- Never use em or en dashes. Use commas, colons, periods, or parentheses instead.
- Return ONLY a JSON object, no markdown or commentary, EXACTLY this shape:
{ "questions": [ { "category": string, "question": string } ] }`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "unauthorized" }, 401);

    const { candidate = null, jobTitle = "the role" } = await req.json();
    const parsed = candidate?.parsed ?? candidate;
    if (!parsed || typeof parsed !== "object") return json({ error: "no_candidate" }, 400);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("aster");
    if (!apiKey) return json({ error: "no_api_key" }, 500);

    // Charge BEFORE the model call; refund if our call fails.
    const paid = await charge(token, "interview_questions");
    if (!paid.ok) {
      const status = paid.error === "limit_reached" ? 402 : 503;
      return json({ error: paid.error, used: paid.used, monthly_limit: paid.limit, resets_at: paid.resetsAt }, status);
    }

    const resume = {
      name: parsed.name ?? null,
      summary: parsed.summary ?? null,
      skills: Array.isArray(parsed.skills) ? parsed.skills.slice(0, 25) : [],
      experience: Array.isArray(parsed.experience)
        ? parsed.experience.slice(0, 6).map((e: any) => ({ title: e?.title ?? null, company: e?.company ?? null, duration: e?.duration ?? null, summary: e?.summary ?? null }))
        : [],
      education: Array.isArray(parsed.education) ? parsed.education.slice(0, 4) : [],
    };

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1600, messages: [{ role: "user", content: `${PROMPT}\n\nRole title: ${String(jobTitle).slice(0, 120)}\n\nResume (JSON):\n${JSON.stringify(resume)}` }] }),
    });
    if (!resp.ok) { console.error("anthropic error", resp.status, await resp.text()); await refund(paid.companyId, "interview_questions"); return json({ error: "generate_failed" }, 502); }
    const data = await resp.json();
    let text = (data.content || []).map((b: any) => (typeof b.text === "string" ? b.text : "")).join(" ").trim();
    text = text.replace(/```json/gi, "").replace(/```/g, "");
    const s = text.indexOf("{"), e = text.lastIndexOf("}");
    let raw: any = null;
    if (s >= 0 && e > s) { try { raw = JSON.parse(text.slice(s, e + 1)); } catch (err) { console.error("json parse", err); } }
    const list = raw && Array.isArray(raw.questions) ? raw.questions : null;
    if (!list) { await refund(paid.companyId, "interview_questions"); return json({ error: "generate_failed" }, 502); }

    // Normalise into the exact [{category, question}] shape the UI groups by.
    const allow = new Set(CATEGORIES);
    const questions = list
      .filter((q: any) => q && typeof q.question === "string" && q.question.trim())
      .map((q: any) => ({
        category: allow.has(q.category) ? q.category : "Role fit",
        question: stripDashes(q.question).slice(0, 400),
      }))
      .slice(0, 15);
    if (!questions.length) { await refund(paid.companyId, "interview_questions"); return json({ error: "generate_failed" }, 502); }

    return json({ questions, used: paid.used, monthly_limit: paid.limit, resets_at: paid.resetsAt });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected" }, 500);
  }
});
