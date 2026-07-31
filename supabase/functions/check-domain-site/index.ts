// Supabase Edge Function: check-domain-site
// ---------------------------------------------------------------------------
// Does the domain behind a sign-up email actually serve a website?
//
// A throwaway signup took a full 14-day Scale trial and its billable AI. That
// address passed four public disposable-domain lists, MX inspection, a domain-age
// check, and Kickbox, which scored it 0.887 — better than gmail.com. The one
// thing that told it apart: copawoke.com serves no website at all. A company
// with roles to fill has a site; a domain bought to catch throwaway mail doesn't.
//
// The verdict is cached per domain in domain_site_checks and read by
// _domain_has_site() when create_company_and_owner decides on a trial. Signup is
// not blocked by this and never waits on it — the form warms the cache while the
// visitor is still filling in the rest, and a domain with no site still gets an
// account, on the same pay-first path a repeat trial already lands on.
//
// FAILS OPEN. If our own fetch is what broke — DNS hiccup, timeout, egress
// trouble — we record has_site: true. Denying a real company its trial because
// our network blinked is far worse than letting one throwaway through.
//
// Response: { domain, has_site, cached }
// Needs no session: it runs on the sign-up screen, before the account exists.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const FRESH_DAYS = 30;
const TIMEOUT_MS = 4000;

// Public providers are exempt: gmail.com obviously has a site, and the trial
// rules treat them by address rather than by domain anyway.
const PUBLIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "msn.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.co.in", "ymail.com", "rocketmail.com",
  "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "pm.me",
  "aol.com", "gmx.com", "gmx.net", "mail.com", "yandex.com", "yandex.ru",
  "zoho.com", "fastmail.com", "hey.com", "tutanota.com",
]);

const domainOf = (s: string) => {
  const v = String(s || "").trim().toLowerCase();
  const d = v.includes("@") ? v.split("@")[1] : v;
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d || "") ? d : "";
};

// A response at all is enough. Not "looks like a real site": onlazy.com answers
// with a bare directory listing and that is still more than a throwaway domain
// manages. Anything 2xx/3xx/4xx means something is listening and serving HTTP;
// only a refused connection or a timeout counts as no site.
async function reachable(host: string): Promise<{ ok: boolean; status?: number }> {
  for (const url of [`https://${host}`, `https://www.${host}`, `http://${host}`]) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: ctl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AsterSignupCheck/1.0)" },
      });
      clearTimeout(t);
      if (r.status < 500) return { ok: true, status: r.status };
    } catch {
      clearTimeout(t);
    }
  }
  return { ok: false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const domain = domainOf(body?.email || body?.domain || "");
    if (!domain) return json({ error: "bad domain" }, 400);

    if (PUBLIC_DOMAINS.has(domain)) return json({ domain, has_site: true, cached: false, note: "public provider" });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data: hit } = await admin
      .from("domain_site_checks")
      .select("has_site, checked_at")
      .eq("domain", domain)
      .maybeSingle();
    if (hit && Date.now() - new Date(hit.checked_at).getTime() < FRESH_DAYS * 864e5) {
      return json({ domain, has_site: hit.has_site, cached: true });
    }

    let has_site: boolean;
    let status: number | null = null;
    let note: string | null = null;
    try {
      const r = await reachable(domain);
      has_site = r.ok;
      status = r.status ?? null;
      if (!r.ok) note = "no response on apex, www or http";
    } catch (e) {
      // See the header: our failure must not cost someone their trial.
      has_site = true;
      note = `check failed, failed open: ${String((e as Error)?.message || e).slice(0, 120)}`;
    }

    await admin.from("domain_site_checks").upsert({
      domain, has_site, http_status: status, note, checked_at: new Date().toISOString(),
    });

    return json({ domain, has_site, cached: false });
  } catch (e) {
    console.error(e);
    return json({ error: "unexpected error" }, 500);
  }
});
