// Supabase Edge Function: confirm-booking
// ---------------------------------------------------------------------------
// The public booking page (/book/<token>, no login) calls this when the
// candidate picks a slot. Token-gated (the unguessable interview token is the
// authorization): validates the chosen slot, persists scheduled_at + status,
// advances the candidate's stage to interviewing, and emails the interviewer
// ("interview scheduled") and the candidate ("interview confirmation").
//
// Secrets: RESEND_API_KEY (optional — skipped if unset)
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, companyShell, loadTemplate, renderTemplate, paragraphs, icsAttachment } from "../_shared/email.ts";
import { pushToUser } from "../_shared/push.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Human-readable slot label. Render in the company's local time (the time the
// interview was scheduled in) with the zone shown, so it matches the in-app panel
// instead of showing a confusing UTC time.
function fmt(iso: string, tz = "Asia/Kuala_Lumpur"): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  };
  try {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz }).format(new Date(iso));
  } catch {
    try { return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "Asia/Kuala_Lumpur" }).format(new Date(iso)); }
    catch { return iso; }
  }
}

// "Tue, Jul 21, 2026, 9:00 AM – 9:45 AM GMT+8": date once, a start-end time range,
// and the zone once at the end. Falls back to the single-time label on any error.
function fmtRange(startIso: string, endIso: string, tz = "Asia/Kuala_Lumpur"): string {
  try {
    const s = new Date(startIso), e = new Date(endIso);
    const datePart = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(s);
    const t = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
    const zone = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", timeZoneName: "short" })
      .formatToParts(s).find((p) => p.type === "timeZoneName")?.value || "";
    return `${datePart}, ${t(s)} – ${t(e)}${zone ? ` ${zone}` : ""}`;
  } catch { return fmt(startIso, tz); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const { token, start } = await req.json();
    if (!token || !start) return json({ error: "token and start are required" }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: iv } = await admin
      .from("interviews")
      .select("id, company_id, candidate_id, job_id, interviewer_name, interviewer_email, proposed_slots, status, attendees")
      .eq("token", token).maybeSingle();
    if (!iv) return json({ error: "not found" }, 404);

    const slots = Array.isArray(iv.proposed_slots) ? iv.proposed_slots : [];
    // Match on the instant, not the exact string: a poll slot comes from a
    // timestamptz ("...+00:00") while proposed_slots hold ISO "...Z" — same time,
    // different text — so string equality would wrongly reject a valid slot.
    const sameInstant = (a?: string, b?: string) => {
      if (!a || !b) return false;
      const ta = new Date(a).getTime(), tb = new Date(b).getTime();
      return !Number.isNaN(ta) && ta === tb;
    };
    const match = slots.find((s: { start?: string }) => s && sameInstant(s.start, start));
    if (!match && iv.status !== "scheduled") return json({ error: "that time is no longer offered" }, 409);
    // Persist the candidate-facing ISO form when we have it, so scheduled_at lines
    // up with proposed_slots.
    const confirmedStart = (match as { start?: string } | undefined)?.start || start;

    // Persist the confirmed time (idempotent: a repeat confirm is a no-op update).
    if (iv.status !== "scheduled") {
      await admin.from("interviews").update({ scheduled_at: confirmedStart, status: "scheduled" }).eq("id", iv.id);
      // Advance the candidate's pipeline stage, unless already further along.
      await admin.from("applications").update({ stage: "interviewing" })
        .eq("company_id", iv.company_id).eq("candidate_id", iv.candidate_id)
        .not("stage", "in", "(offer,hired,rejected)");
    }

    // Gather tokens for the two emails.
    const { data: comp } = await admin.from("companies").select("name, logo_url").eq("id", iv.company_id).maybeSingle();
    // Timezone loaded SEPARATELY so a missing column (0091 not deployed) can't null
    // out the whole company row and drop the name/logo from the email.
    let tz = "Asia/Kuala_Lumpur";
    try { const { data: tzr } = await admin.from("companies").select("timezone").eq("id", iv.company_id).maybeSingle(); if (tzr?.timezone) tz = tzr.timezone; } catch { /* pre-0091 */ }
    const companyName = comp?.name || "the hiring team";
    const logoUrl = comp?.logo_url || null;
    let jobTitle = "the role";
    if (iv.job_id) {
      const { data: job } = await admin.from("jobs").select("title").eq("id", iv.job_id).maybeSingle();
      jobTitle = job?.title || jobTitle;
    }
    const { data: cand } = await admin.from("candidates").select("email, full_name").eq("id", iv.candidate_id).maybeSingle();
    const slotEnd = match && (match as { end?: string }).end ? String((match as { end?: string }).end) : null;
    // Show a start-end range when the slot's end is known, else the single time.
    const dateTime = slotEnd ? fmtRange(String(start), slotEnd, tz) : fmt(String(start), tz);

    // A calendar invite (.ics) so both sides can add the interview to their own
    // calendar straight from the email. End time from the chosen slot, else +60m.
    const endIso = slotEnd || new Date(new Date(String(start)).getTime() + 60 * 60000).toISOString();
    const ics = icsAttachment({
      uid: `${iv.id}@hireaster.com`,
      startIso: String(start), endIso,
      title: `Interview: ${jobTitle} at ${companyName}`,
      description: `Interview for the ${jobTitle} role at ${companyName}.`,
      organizerName: companyName,
    });
    const attachments = ics ? [ics] : undefined;

    // 1) Candidate confirmation.
    if (cand?.email) {
      try {
        const tpl = await loadTemplate(admin, "interview_confirmation", iv.company_id, {
          subject: "Your interview is confirmed: {{date_time}}",
          body: "Hi {{candidate_name}},\n\nYour interview for the {{job_title}} role is confirmed for {{date_time}}. Your interviewer will share the meeting link before the call. We look forward to speaking with you.",
        });
        const tokens = { candidate_name: cand.full_name || "there", job_title: jobTitle, company_name: companyName, date_time: dateTime, meeting_link: "" };
        await sendEmail({
          to: cand.email,
          subject: renderTemplate(tpl.subject, tokens),
          html: companyShell({ companyName, logoUrl, heading: "Your interview is confirmed", preview: `Confirmed for ${dateTime}.`, bodyHtml: paragraphs(renderTemplate(tpl.body, tokens)) }),
          attachments,
        });
      } catch (e) { console.error("candidate confirmation email failed", e); }
    }

    // 2) Interviewer notice — to EVERY attendee on the panel (the hiring manager
    // plus the interviewers they picked), not just the primary contact.
    const recipients = new Set<string>();
    const attendees = Array.isArray(iv.attendees) ? iv.attendees : [];
    for (const a of attendees) {
      const e = (a && typeof a.email === "string") ? a.email.trim().toLowerCase() : "";
      if (e) recipients.add(e);
    }
    if (iv.interviewer_email) recipients.add(String(iv.interviewer_email).trim().toLowerCase());
    // Also include everyone CURRENTLY on the job's interviewer panel. The attendees
    // snapshot is frozen when the invite is sent, so interviewers assigned to the
    // job afterwards aren't in it. Union them in here so the whole panel is notified.
    if (iv.job_id) {
      try {
        const { data: asg } = await admin.from("job_assignments")
          .select("profile_id").eq("company_id", iv.company_id).eq("job_id", iv.job_id);
        const ids = (asg || []).map((a: { profile_id?: string }) => a.profile_id).filter(Boolean);
        if (ids.length) {
          const { data: profs } = await admin.from("profiles").select("email").in("id", ids);
          for (const p of profs || []) {
            const e = (p && typeof p.email === "string") ? p.email.trim().toLowerCase() : "";
            if (e) recipients.add(e);
          }
        }
      } catch (e) { console.error("job panel recipients lookup failed", e); }
    }
    if (recipients.size) {
      try {
        const tpl = await loadTemplate(admin, "interview_scheduled", iv.company_id, {
          subject: "Interview scheduled: {{candidate_name}} for {{job_title}}",
          body: "{{candidate_name}} confirmed an interview for the {{job_title}} role on {{date_time}}. It's on your calendar.",
        });
        const tokens = { candidate_name: cand?.full_name || "The candidate", job_title: jobTitle, date_time: dateTime, meeting_link: "" };
        const subject = renderTemplate(tpl.subject, tokens);
        const html = companyShell({ companyName, logoUrl, heading: "Interview scheduled", preview: `${cand?.full_name || "A candidate"} confirmed ${dateTime}.`, bodyHtml: paragraphs(renderTemplate(tpl.body, tokens)), signoff: false });
        // Best-effort per recipient: one failure must not drop the rest.
        await Promise.all([...recipients].map((to) => sendEmail({ to, subject, html, attachments }).catch((e) => console.error("interviewer email failed", to, e))));
      } catch (e) { console.error("interviewer emails failed", e); }
    }

    // Log the booking for the notification bell, only on the first confirm.
    if (iv.status !== "scheduled") {
      await admin.from("activity_log").insert({ company_id: iv.company_id, type: "interview_scheduled", title: `Interview scheduled with ${cand?.full_name || "a candidate"}`, description: `${jobTitle} · ${dateTime}`, candidate_id: iv.candidate_id, job_id: iv.job_id });

      // Push the panel's interviewers on their phones (first confirm only, to
      // match the activity log). Best-effort: a push failure changes nothing.
      if (iv.job_id) {
        try {
          const { data: asg } = await admin.from("job_assignments")
            .select("profile_id").eq("company_id", iv.company_id).eq("job_id", iv.job_id);
          const ids = [...new Set((asg || []).map((a: { profile_id?: string }) => a.profile_id).filter(Boolean))];
          await Promise.all(ids.map((uid: string) => pushToUser(admin, uid, {
            title: "Interview scheduled",
            body: `${cand?.full_name || "A candidate"} · ${jobTitle} · ${dateTime}`,
            data: { url: `aster://interview/${iv.candidate_id}` },
          })));
        } catch (e) { console.error("panel push failed", e); }
      }
    }

    return json({ ok: true, company_name: companyName, job_title: jobTitle, date_time: dateTime });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
