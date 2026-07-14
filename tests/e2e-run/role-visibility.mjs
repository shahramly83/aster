// What each role can actually SEE through RLS, with 10 jobs / 50 candidates loaded.
// A role that can read rows it should not is a data-isolation bug; one that can't
// read what it needs is a broken journey. Both matter.
import { createClient } from "@supabase/supabase-js";
const URL = "https://edaefharlofwhnmcbiwk.supabase.co";
const ANON = process.env.ANON;

const as = async (email) => {
  const sb = createClient(URL, ANON);
  const { error } = await sb.auth.signInWithPassword({ email, password: "password123@" });
  return error ? null : sb;
};
const count = async (sb, t) => {
  const { count, error } = await sb.from(t).select("*", { count: "exact", head: true });
  return error ? `ERR ${error.message.slice(0, 40)}` : count;
};

for (const [email, role] of [
  ["tenant@onlazy.com", "owner"],
  ["hiring1@onlazy.com", "hiring manager"],
  ["interviewer1@onlazy.com", "interviewer"],
]) {
  const sb = await as(email);
  if (!sb) { console.log(`\n${role}: cannot sign in`); continue; }
  console.log(`\n== ${role} (${email}) ==`);
  for (const t of ["jobs", "candidates", "applications", "job_assignments", "subscriptions"]) {
    console.log(`  ${t.padEnd(16)} ${await count(sb, t)}`);
  }
  await sb.auth.signOut();
}
console.log("\nExpected: owner + HM see all 10 jobs / 50 candidates; interviewer sees only");
console.log("assigned OPEN jobs (4) and the candidates on them, and 0 subscriptions rows.");
