// Billing permissions, executed as a REAL non-owner rather than read off the source.
// An untested permission check is not a permission check.
//
//   ANON=<anon key> node tests/e2e-run/billing-roles.mjs
import { createClient } from "@supabase/supabase-js";

const URL = "https://edaefharlofwhnmcbiwk.supabase.co";
const ANON = process.env.ANON;
const PASSWORD = "password123@";

// Anyone who is not the account owner. Add hiring managers here as they accept.
const NON_OWNERS = [
  { email: "interviewer1@onlazy.com", role: "interviewer" },
  { email: "hiring1@onlazy.com", role: "hiring manager" },
];

let pass = 0, fail = 0, skip = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
};

const asUser = async (email) => {
  const sb = createClient(URL, ANON);
  const { data, error } = await sb.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) return null;
  return { sb, token: data.session.access_token };
};

const call = async (fn, token, body = {}) => {
  const res = await fetch(`${URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  let data = null; try { data = await res.json(); } catch { /* */ }
  return { status: res.status, data };
};

for (const who of NON_OWNERS) {
  console.log(`\n== ${who.email} (${who.role}) ==`);
  const session = await asUser(who.email);
  if (!session) { skip++; console.log("  SKIP  has not accepted their invite yet"); continue; }
  const { sb, token } = session;

  // The three things money hangs on.
  const buy = await call("create-checkout-session", token, { plan: "elite", cycle: "monthly" });
  ok(`${who.role} CANNOT change the plan`, buy.status === 403, `got ${buy.status} ${JSON.stringify(buy.data)}`);

  const portal = await call("create-portal-session", token, {});
  ok(`${who.role} CANNOT open the billing portal (card + cancellation)`, portal.status === 403, `got ${portal.status}`);

  const inv = await call("list-invoices", token, {});
  ok(`${who.role} CANNOT read the company's invoices`, inv.status === 403, `got ${inv.status} ${JSON.stringify(inv.data).slice(0, 120)}`);

  // And the data underneath it: RLS must not hand them the billing row either,
  // whatever the edge functions do.
  const { data: subs } = await sb.from("subscriptions").select("stripe_customer_id, plan, status");
  ok(`${who.role} CANNOT read stripe ids straight out of the subscriptions table`,
    !subs?.length || !subs.some((s) => s.stripe_customer_id),
    `got ${JSON.stringify(subs)}`);

  await sb.auth.signOut();
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed, ${skip} skipped\n`);
process.exit(fail === 0 ? 0 : 1);
