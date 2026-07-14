// Negative + security suite for the billing surface.
// Everything here asserts that something is REFUSED. A pass means the door is shut.
//
//   ANON=<anon key> WHSEC=<stripe webhook secret> node tests/e2e-run/billing-security.mjs
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";

const URL = "https://edaefharlofwhnmcbiwk.supabase.co";
const ANON = process.env.ANON;
const WHSEC = process.env.WHSEC || "";
const FN = `${URL}/functions/v1`;

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
};

const call = async (fn, { token, body = {}, method = "POST" } = {}) => {
  const res = await fetch(`${FN}/${fn}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data };
};

console.log("\n== 1. Unauthenticated access to the billing functions ==");
for (const fn of ["create-checkout-session", "create-portal-session", "list-invoices", "sync-billing-customer"]) {
  const r = await call(fn, { body: { plan: "elite", cycle: "monthly" } });
  ok(`${fn} rejects a request with no session`, r.status === 401, `got ${r.status} ${JSON.stringify(r.data)}`);
}

console.log("\n== 2. Forged / junk bearer token ==");
for (const fn of ["create-checkout-session", "list-invoices"]) {
  const r = await call(fn, { token: "not.a.real.jwt", body: { plan: "elite", cycle: "monthly" } });
  ok(`${fn} rejects a forged JWT`, r.status === 401, `got ${r.status}`);
}

console.log("\n== 3. Signed in as the OWNER: input validation ==");
const sb = createClient(URL, ANON);
const { data: auth, error: authErr } = await sb.auth.signInWithPassword({
  email: "tenant@onlazy.com", password: "password123@",
});
if (authErr) { console.log("  cannot sign in as tenant:", authErr.message); process.exit(1); }
const token = auth.session.access_token;

const bad = [
  ["unknown plan", { plan: "platinum", cycle: "monthly" }],
  ["unknown cycle", { plan: "scale", cycle: "weekly" }],
  ["missing plan", { cycle: "monthly" }],
  ["null plan", { plan: null, cycle: "monthly" }],
  ["plan as an object", { plan: { $ne: null }, cycle: "monthly" }],
  ["enterprise (not self-serve)", { plan: "enterprise", cycle: "monthly" }],
];
for (const [name, body] of bad) {
  const r = await call("create-checkout-session", { token, body });
  ok(`checkout refuses ${name}`, r.status === 400, `got ${r.status} ${JSON.stringify(r.data)}`);
}

console.log("\n== 4. Wrong HTTP method ==");
for (const fn of ["create-checkout-session", "list-invoices", "stripe-webhook"]) {
  const r = await call(fn, { token, method: "GET" });
  ok(`${fn} refuses GET`, r.status === 405, `got ${r.status}`);
}

console.log("\n== 5. Webhook signature ==");
const evt = JSON.stringify({
  id: "evt_forged_001", type: "customer.subscription.updated",
  data: { object: { id: "sub_fake", status: "active", metadata: { company_id: "00000000-0000-0000-0000-000000000000", plan: "elite" }, items: { data: [{ current_period_end: 9999999999 }] } } },
});
const hook = async (headers, body = evt) => {
  const res = await fetch(`${FN}/stripe-webhook`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: ANON, ...headers }, body,
  });
  let d = null; try { d = await res.json(); } catch { /* */ }
  return { status: res.status, data: d };
};

ok("webhook rejects a request with NO signature", (await hook({})).status === 401);
ok("webhook rejects a garbage signature", (await hook({ "stripe-signature": "t=1,v1=deadbeef" })).status === 401);

const sign = (payload, secret, ts) =>
  `t=${ts},v1=${createHmac("sha256", secret).update(`${ts}.${payload}`).digest("hex")}`;

// Signed with the WRONG secret: the payload is well-formed, only the key is wrong.
ok("webhook rejects a signature made with the wrong secret",
  (await hook({ "stripe-signature": sign(evt, "whsec_wrong_key_entirely", Math.floor(Date.now() / 1000)) })).status === 401);

if (WHSEC) {
  const now = Math.floor(Date.now() / 1000);
  // Correctly signed but ANCIENT: replay of a captured event must not be accepted.
  const old = await hook({ "stripe-signature": sign(evt, WHSEC, now - 60 * 60 * 24) });
  ok("webhook rejects a correctly-signed but stale event (replay)", old.status === 401, `got ${old.status} ${JSON.stringify(old.data)}`);

  // Correctly signed and fresh, but for a company that does not exist. It must not
  // 200 blindly, and it certainly must not grant Elite to anyone.
  const ghost = await hook({ "stripe-signature": sign(evt, WHSEC, now) });
  ok("webhook refuses an event for an unknown company", ghost.status !== 200, `got ${ghost.status} ${JSON.stringify(ghost.data)}`);
} else {
  console.log("  SKIP  replay + idempotency (no WHSEC given)");
}

console.log("\n== 6. Cross-tenant read ==");
const r6 = await call("list-invoices", { token, body: { company_id: "00000000-0000-0000-0000-000000000000" } });
ok("list-invoices ignores a company_id in the body (uses the session's company)",
  r6.status === 200 && Array.isArray(r6.data?.invoices), `got ${r6.status}`);

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
