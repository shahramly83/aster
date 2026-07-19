// Supabase Edge Function: decline-booking
// ---------------------------------------------------------------------------
// The public booking page (/book/<token>, no login) calls this when the
// candidate can't make ANY proposed time and suggests their own dates instead.
// Token-gated (the unguessable interview token is the authorization): records
// the optional decline note, marks the interview 'reschedule', and turns the
// candidate's suggested dates into a panel poll (proposed_by='candidate') — so
// the panel votes on which of the candidate's times they can make (round 2, the
// original poll with the roles reversed). Emails + pushes the panel to vote and
// acknowledges the candidate.
//
// Secrets: RESEND_API_KEY (optional — email skipped if unset)
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, companyShell, esc } from "../_shared/email.ts";
import { pushToUser } from "../_shared/push.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const { token, slots, note } = await req.json();
    const clean = (Array.isArray(slots) ? slots : [])
      .filter((s: { start?: string }) => s && s.start)
      .map((s: { start: string; end?: string }) => ({ start: String(s.start), end: s.end ? String(s.end) : null }));
    if (!token) return json({ error: "token is required" }, 400);
    if (clean.length < 2) return json({ error: "suggest at least two times" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: iv } = await admin
      .from("interviews")
      .select("id, company_id, candidate_id, job_id, interviewer_id, interviewer_email, status")
      .eq("token", token).maybeSingle();
    if (!iv) return json({ error: "not found" }, 404);
    if (iv.status === "scheduled") return json({ error: "this interview is already scheduled" }, 409);

    // Close any open poll for this candidate (the round-1 panel poll), then create
    // the candidate's round-2 poll from their suggested dates.
    await admin.from("interview_polls")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("company_id", iv.company_id).eq("candidate_id", iv.candidate_id).eq("status", "open");

    const { data: poll, error: pErr } = await admin.from("interview_polls").insert({
      company_id: iv.company_id, candidate_id: iv.candidate_id, job_id: iv.job_id,
      created_by: iv.interviewer_id || null, status: "open", proposed_by: "candidate",
    }).select("id").single();
    if (pErr || !poll) { console.error("poll create failed", pErr); return json({ error: "could not create poll" }, 500); }

    await admin.from("interview_poll_slots").insert(clean.map((s) => ({
      poll_id: poll.id, company_id: iv.company_id, slot_ts: s.start, slot_end: s.end,
    })));

    // Mark the interview as needing a reschedule + store the candidate's note.
    await admin.from("interviews").update({
      status: "reschedule",
      reschedule_note: (note && String(note).trim()) || null,
      reschedule_at: new Date().toISOString(),
      proposed_slots: clean,
    }).eq("id", iv.id);

    // Context for messaging.
    const { data: comp } = await admin.from("companies").select("name, logo_url").eq("id", iv.company_id).maybeSingle();
    const companyName = comp?.name || "the hiring team";
    const logoUrl = comp?.logo_url || null;
    let jobTitle = "the role";
    if (iv.job_id) { const { data: job } = await admin.from("jobs").select("title").eq("id", iv.job_id).maybeSingle(); jobTitle = job?.title || jobTitle; }
    const { data: cand } = await admin.from("candidates").select("email, full_name").eq("id", iv.candidate_id).maybeSingle();
    const candName = cand?.full_name || "The candidate";

    // Notify the panel: email + push + activity bell.
    const recipients = new Set<string>();
    if (iv.interviewer_email) recipients.add(String(iv.interviewer_email).trim().toLowerCase());
    let panelIds: string[] = [];
    if (iv.job_id) {
      const { data: asg } = await admin.from("job_assignments").select("profile_id").eq("company_id", iv.company_id).eq("job_id", iv.job_id);
      panelIds = [...new Set((asg || []).map((a: { profile_id?: string }) => a.profile_id).filter(Boolean))] as string[];
      if (panelIds.length) {
        const { data: profs } = await admin.from("profiles").select("email").in("id", panelIds);
        for (const p of profs || []) { const e = (p?.email || "").trim().toLowerCase(); if (e) recipients.add(e); }
      }
    }
    const noteLine = (note && String(note).trim()) ? `<p style="margin:0 0 10px;color:#4B5563"><em>&ldquo;${esc(String(note).trim())}&rdquo;</em></p>` : "";
    if (recipients.size) {
      const subject = `${candName} suggested new interview times for ${jobTitle}`;
      const html = companyShell({
        companyName, logoUrl, heading: "New times to vote on",
        preview: `${candName} couldn't make the proposed times.`,
        bodyHtml: `<p style="margin:0 0 10px">${esc(candName)} couldn't make any of the proposed times for the <strong>${esc(jobTitle)}</strong> role and suggested ${clean.length} of their own.</p>${noteLine}<p style="margin:0">Open Aster to mark which of their times you can make.</p>`,
        signoff: false,
      });
      await Promise.all([...recipients].map((to) => sendEmail({ to, subject, html }).catch((e) => console.error("panel email failed", to, e))));
    }
    await admin.from("activity_log").insert({
      company_id: iv.company_id, type: "interview_reschedule",
      title: `${candName} suggested new interview times`,
      description: `${jobTitle} · vote on their availability`,
      candidate_id: iv.candidate_id, job_id: iv.job_id,
    });
    await Promise.all(panelIds.map((uid) => pushToUser(admin, uid, {
      title: "New interview times to vote on",
      body: `${candName} · ${jobTitle}`,
      data: { url: `aster://interview/${iv.candidate_id}` },
    }).catch(() => {})));

    // Acknowledge the candidate.
    if (cand?.email) {
      await sendEmail({
        to: cand.email,
        subject: "Thanks — we'll confirm a new time",
        html: companyShell({
          companyName, logoUrl, heading: "Thanks for suggesting times",
          preview: "We'll confirm a time that works for everyone.",
          bodyHtml: `<p style="margin:0">Thanks${cand.full_name ? `, ${esc(cand.full_name.split(" ")[0])}` : ""}. We've shared your suggested times with the interview panel and will email you to confirm the one that works for everyone.</p>`,
        }),
      }).catch((e) => console.error("candidate ack failed", e));
    }

    return json({ ok: true, poll_id: poll.id, company_name: companyName, job_title: jobTitle });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
