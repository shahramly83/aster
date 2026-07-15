// Supabase Edge Function: scheduled-emails
// ---------------------------------------------------------------------------
// Cron-driven Tier 1 (platform) emails. Invoked by the scheduled-emails GitHub
// Action, gated by a shared CRON_SECRET header (the function runs with the
// service role internally to read across all companies). Two tasks:
//
//   task: "weekly_digest"  — for each ACTIVE company with new applicants this
//                            week, email owners/admins a roll-up. Sends nothing
//                            to companies with zero new applicants (an empty
//                            report is worse than silence).
//   task: "trial_ending"   — email owners/admins whose trial ends in 3 days.
//
// Secrets: CRON_SECRET (required), RESEND_API_KEY (optional — skipped if unset)
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, emailShell, companyShell, loadTemplate, renderTemplate, paragraphs } from "../_shared/email.ts";

const SITE = "https://hireaster.com";

// Human-readable slot label. Render in the company's local time (same convention
// as confirm-booking) so reminders match the time shown in the app.
function fmtWhen(iso: string, tz = "Asia/Kuala_Lumpur"): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  };
  try {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz }).format(new Date(iso));
  } catch {
    try { return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "Asia/Kuala_Lumpur" }).format(new Date(iso)); }
    catch { return iso; }
  }
}
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

type Admin = { from: (t: string) => any };

// Active owners/admins of a company: who receives platform notices, plus a name
// for the greeting.
async function ownersOf(admin: Admin, companyId: string): Promise<{ to: string[]; name: string }> {
  const { data } = await admin.from("profiles").select("email, full_name, role")
    .eq("company_id", companyId).in("role", ["owner", "admin"]).eq("status", "active").not("email", "is", null);
  const rows = (data || []) as { email: string; full_name?: string; role: string }[];
  const to = rows.map((r) => r.email).filter(Boolean);
  const owner = rows.find((r) => r.role === "owner") || rows[0];
  const name = (owner?.full_name || "there").split(" ")[0] || "there";
  return { to, name };
}

async function runWeeklyDigest(admin: Admin): Promise<number> {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: companies } = await admin.from("companies").select("id, name").eq("status", "active");
  let sent = 0;
  for (const c of (companies || []) as { id: string; name: string }[]) {
    const { count: applicants } = await admin.from("applications")
      .select("id", { count: "exact", head: true }).eq("company_id", c.id).gte("created_at", weekAgo);
    if (!applicants) continue; // no activity → no email
    const { count: jobs } = await admin.from("jobs")
      .select("id", { count: "exact", head: true }).eq("company_id", c.id).eq("status", "open");
    const { to, name } = await ownersOf(admin, c.id);
    if (!to.length) continue;

    const tpl = await loadTemplate(admin, "weekly_digest", null, {
      subject: "Your week on Aster: {{applicant_count}} new applicants",
      body: `<p>Hi {{recipient_name}},</p>
<p>This week {{company_name}} received <strong>{{applicant_count}}</strong> new applicants across {{job_count}} roles.</p>
<p><a href="{{cta_link}}">Review them in your dashboard</a></p>`,
    });
    const tokens = {
      recipient_name: name, company_name: c.name || "your team",
      applicant_count: String(applicants), job_count: String(jobs || 0), cta_link: `${SITE}/login`,
    };
    await sendEmail({
      to, subject: renderTemplate(tpl.subject, tokens),
      html: emailShell({ heading: "Your week on Aster", preview: `${applicants} new applicants this week.`, bodyHtml: renderTemplate(tpl.body, tokens), footnote: "You're receiving your weekly Aster digest." }),
    });
    sent++;
  }
  return sent;
}

async function runTrialEnding(admin: Admin): Promise<number> {
  // Trials ending in exactly 3 days (one clean day, so it sends once).
  const target = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const { data: subs } = await admin.from("subscriptions")
    .select("company_id, current_period_end, companies(name)")
    .eq("status", "trialing").eq("current_period_end", target);
  let sent = 0;
  for (const s of (subs || []) as { company_id: string; current_period_end: string; companies?: { name?: string } }[]) {
    const { to, name } = await ownersOf(admin, s.company_id);
    if (!to.length) continue;
    const companyName = s.companies?.name || "your team";
    const endLabel = new Date(s.current_period_end + "T00:00:00Z").toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

    const tpl = await loadTemplate(admin, "trial_ending", null, {
      subject: "Your Aster trial ends {{trial_end_date}}",
      body: `<p>Hi {{recipient_name}},</p>
<p>Your free trial for {{company_name}} ends on {{trial_end_date}}. Add a plan to keep your jobs live and your candidate pipeline intact.</p>
<p><a href="{{cta_link}}">Choose a plan</a></p>`,
    });
    const tokens = { recipient_name: name, company_name: companyName, trial_end_date: endLabel, cta_link: `${SITE}/login` };
    await sendEmail({
      to, subject: renderTemplate(tpl.subject, tokens),
      html: emailShell({ heading: "Your trial is ending soon", preview: `Your ${companyName} trial ends ${endLabel}.`, bodyHtml: renderTemplate(tpl.body, tokens), footnote: "You're receiving this because your Aster trial is ending." }),
    });
    sent++;
  }
  return sent;
}

// Remind the candidate + panel about interviews happening in the next ~28h that
// haven't been reminded yet. reminder_sent_at (0060) is stamped after, so a
// candidate is reminded exactly once no matter how often the cron runs.
async function runInterviewReminder(admin: Admin): Promise<number> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 28 * 3600 * 1000).toISOString();
  const { data: ivs } = await admin.from("interviews")
    .select("id, company_id, candidate_id, job_id, scheduled_at, attendees")
    .eq("status", "scheduled")
    .is("reminder_sent_at", null)
    .gte("scheduled_at", now.toISOString())
    .lte("scheduled_at", windowEnd);
  let sent = 0;
  for (const iv of (ivs || []) as { id: string; company_id: string; candidate_id: string; job_id: string | null; scheduled_at: string; attendees: { email?: string }[] | null }[]) {
    const { data: comp } = await admin.from("companies").select("name, logo_url, timezone").eq("id", iv.company_id).maybeSingle();
    const companyName = comp?.name || "the hiring team";
    const logoUrl = comp?.logo_url || null;
    let jobTitle = "the role";
    if (iv.job_id) { const { data: job } = await admin.from("jobs").select("title").eq("id", iv.job_id).maybeSingle(); jobTitle = job?.title || jobTitle; }
    const { data: cand } = await admin.from("candidates").select("email, full_name").eq("id", iv.candidate_id).maybeSingle();
    const dateTime = fmtWhen(iv.scheduled_at, comp?.timezone || "Asia/Kuala_Lumpur");

    // 1) Candidate reminder (company-branded).
    if (cand?.email) {
      try {
        const tpl = await loadTemplate(admin, "interview_reminder", iv.company_id, {
          subject: "Reminder: your interview is coming up ({{date_time}})",
          body: "Hi {{candidate_name}},\n\nA quick reminder that your interview for the {{job_title}} role is coming up on {{date_time}}. Your interviewer will share the meeting link before the call. We look forward to speaking with you.",
        });
        const tokens = { candidate_name: cand.full_name || "there", job_title: jobTitle, company_name: companyName, date_time: dateTime };
        await sendEmail({
          to: cand.email,
          subject: renderTemplate(tpl.subject, tokens),
          html: companyShell({ companyName, logoUrl, heading: "Your interview is coming up", preview: `Reminder for ${dateTime}.`, bodyHtml: paragraphs(renderTemplate(tpl.body, tokens)) }),
        });
      } catch (e) { console.error("candidate reminder failed", e); }
    }

    // 2) Panel reminder (every attendee).
    const recipients = new Set<string>();
    for (const a of (Array.isArray(iv.attendees) ? iv.attendees : [])) {
      const e = (a && typeof a.email === "string") ? a.email.trim().toLowerCase() : "";
      if (e) recipients.add(e);
    }
    if (recipients.size) {
      try {
        const subject = `Reminder: interview with ${cand?.full_name || "a candidate"} on ${dateTime}`;
        const html = companyShell({ companyName, logoUrl, heading: "Interview reminder", preview: `${cand?.full_name || "A candidate"} · ${dateTime}.`, bodyHtml: paragraphs(`Reminder: your interview with ${cand?.full_name || "the candidate"} for the ${jobTitle} role is on ${dateTime}.`), signoff: false });
        await Promise.all([...recipients].map((to) => sendEmail({ to, subject, html }).catch((e) => console.error("panel reminder failed", to, e))));
      } catch (e) { console.error("panel reminders failed", e); }
    }

    // Stamp so it never sends twice.
    await admin.from("interviews").update({ reminder_sent_at: new Date().toISOString() }).eq("id", iv.id);
    sent++;
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const secret = Deno.env.get("CRON_SECRET");
    if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "forbidden" }, 403);

    const { task } = await req.json();
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let sent = 0;
    if (task === "weekly_digest") sent = await runWeeklyDigest(admin);
    else if (task === "trial_ending") sent = await runTrialEnding(admin);
    else if (task === "interview_reminder") sent = await runInterviewReminder(admin);
    else return json({ error: "unknown task" }, 400);

    return json({ ok: true, task, sent });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
