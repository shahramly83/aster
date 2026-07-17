// Loads the signed-in user's profile + company, scoped for the interviewer app.
// A trimmed mirror of loadCustomerSession() in the web app: mobile only needs
// identity, role, company and timezone, not billing/address/onboarding.
import { supabase } from "./supabase";
import { ROLE_LABELS } from "@aster/shared";

export async function loadSession() {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("company_id, full_name, role, avatar_path, calendar_provider, companies ( name, slug, plan, timezone )")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data) return null;

  const co = data.companies || {};
  const rawName = (data.full_name || "").trim();
  // Treat a bare email in full_name as "no name set", same rule as web.
  const looksLikeEmail = /\S+@\S+\.\S+/.test(rawName) && !/\s/.test(rawName);
  const name = looksLikeEmail ? "" : rawName;

  return {
    userId: user.id,
    email: user.email || "",
    companyId: data.company_id,
    name,
    role: data.role || "interviewer",
    roleLabel: ROLE_LABELS[data.role] || "Interviewer",
    company: co.name || "Your workspace",
    companySlug: co.slug || null,
    plan: co.plan || "launch",
    timezone: co.timezone || undefined,
    avatarPath: data.avatar_path || null,
    calendarProvider: data.calendar_provider || null,
  };
}

// Jobs this interviewer is assigned to (job_assignments.profile_id = me). The
// RLS insert policy for scorecards is `job_id in assigned_job_ids()`, so this is
// also the set of jobs whose candidates they may score.
export async function loadAssignedJobIds(companyId, userId) {
  const { data } = await supabase
    .from("job_assignments")
    .select("job_id")
    .eq("company_id", companyId)
    .eq("profile_id", userId);
  return (data || []).map((r) => r.job_id);
}
