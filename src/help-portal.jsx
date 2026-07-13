// Aster Help — the public support center served at help.hireaster.com.
//
// A single, account-less "contact support" page. Anyone can file a ticket; it
// lands in public.support_tickets via the submit_support_ticket RPC (a narrow
// SECURITY DEFINER door, see migration 0015) and shows up for support admins in
// the internal console. When Supabase isn't configured the form still works and
// returns a preview confirmation, so the page never breaks before the backend
// is wired up.
import { useState, useEffect } from "react";
import { supabase, hasSupabase } from "./lib/supabase";

const HELP_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600&display=swap');
  .help { --brand:#0B2AE0; --ink:#0F1222; --ink-2:#4A4E63; --ink-3:#8A8FA6; --line:#E7E8EF; --bg:#FBFBFE;
          font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          -webkit-font-smoothing: antialiased; }
  .help-display { font-family: 'Plus Jakarta Sans', 'Inter', ui-sans-serif, system-ui, sans-serif; letter-spacing: -0.02em; }
  .help-grad { background-image: linear-gradient(135deg,#5570F5,#0B2AE0 55%,#3550EE); }
  .help-field { transition: border-color .15s ease, box-shadow .15s ease; }
  .help-field:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px rgba(11,42,224,.15); }
`;

const CATEGORIES = ["Account & billing", "Uploading resumes", "AI ranking", "Interviews & scheduling", "Sales enquiry", "Something else"];

export default function HelpPortal() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot: stays empty for humans
  const [status, setStatus] = useState("idle"); // idle | submitting | done
  const [ticketId, setTicketId] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = HELP_STYLES;
    document.head.appendChild(el);
    document.title = "Aster Help: Contact support";
    return () => el.remove();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    if (!name.trim() || !email.trim() || !subject.trim()) {
      setErr("Please add your name, email, and a subject so we can help.");
      return;
    }
    if (!email.includes("@")) { setErr("That email address does not look right."); return; }

    // Honeypot tripped (bot autofilled the hidden field): act as if it worked.
    if (website.trim()) { setTicketId("T-0"); setStatus("done"); return; }

    setStatus("submitting");
    // Prefix the subject with the chosen category for quick triage.
    const fullSubject = `[${category}] ${subject.trim()}`;
    try {
      let id;
      if (hasSupabase) {
        // Prefer the support-intake edge function: it files the ticket via the
        // same RPC AND emails the requester a confirmation. If it isn't deployed
        // (or errors), fall back to the RPC directly so filing still works — the
        // confirmation email is simply skipped in that case.
        const fnRes = await supabase.functions.invoke("support-intake", {
          body: { name: name.trim(), email: email.trim(), subject: fullSubject, body: message.trim() || null, website },
        });
        if (!fnRes.error && fnRes.data?.id) {
          id = fnRes.data.id;
        } else {
          const { data, error } = await supabase.rpc("submit_support_ticket", {
            p_name: name.trim(), p_email: email.trim(), p_subject: fullSubject, p_body: message.trim() || null,
            p_website: website,
          });
          if (error) throw error;
          id = data;
        }
      } else {
        id = "T-preview"; // mock fallback: no backend wired up
      }
      setTicketId(id);
      setStatus("done");
    } catch (e2) {
      setErr(e2?.message || "Something went wrong. Please try again in a moment.");
      setStatus("idle");
    }
  };

  const inputCls = "help-field w-full rounded-xl bg-white border border-[color:var(--line)] px-3.5 py-2.5 text-[15px] text-[color:var(--ink)] placeholder:text-[color:var(--ink-3)]";

  return (
    <div className="help min-h-screen" style={{ background: "var(--bg)", color: "var(--ink)" }}>
      {/* Header */}
      <header className="border-b" style={{ borderColor: "var(--line)" }}>
        <div className="max-w-5xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <a href="https://hireaster.com" className="flex items-center gap-2.5">
            <img src="/aster-logo.png" alt="Aster" className="h-9 sm:h-10 w-auto object-contain" />
            <span className="text-[15px] font-medium" style={{ color: "var(--ink-3)" }}>Help</span>
          </a>
          <a href="https://hireaster.com" aria-label="Aster home" title="Aster home" className="inline-flex items-center justify-center transition-opacity hover:opacity-70" style={{ color: "var(--brand)" }}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V9.5Z" /></svg>
          </a>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 sm:px-8 py-12 sm:py-16">
        {status === "done" ? (
          <Confirmation ticketId={ticketId} email={email} onAnother={() => {
            setStatus("idle"); setTicketId(null); setSubject(""); setMessage("");
          }} />
        ) : (
          <>
            <div className="text-center mb-9">
              <h1 className="help-display text-3xl sm:text-[38px] font-bold tracking-tight leading-[1.1]">How can we help?</h1>
              <p className="mt-3 text-[15px] sm:text-base leading-relaxed" style={{ color: "var(--ink-2)" }}>
                Tell us what is going on and we will get back to you by email, usually within one business day.
              </p>
            </div>

            <form onSubmit={submit} className="rounded-2xl bg-white border border-[color:var(--line)] p-5 sm:p-7 shadow-[0_18px_50px_-24px_rgba(15,18,34,0.25)]">
              {/* Honeypot: hidden from humans (off-screen, not tabbable, aria-hidden).
                  Bots that autofill every field trip it and get silently dropped. */}
              <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
                <label>Company website
                  <input type="text" name="website" tabIndex={-1} autoComplete="off"
                    value={website} onChange={(e) => setWebsite(e.target.value)} />
                </label>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Your name">
                  <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Lee" autoComplete="name" />
                </Field>
                <Field label="Email">
                  <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" />
                </Field>
              </div>

              <div className="mt-4">
                <Field label="What is this about?">
                  <select className={inputCls + " appearance-none"} value={category} onChange={(e) => setCategory(e.target.value)}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
              </div>

              <div className="mt-4">
                <Field label="Subject">
                  <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Short summary of your issue" />
                </Field>
              </div>

              <div className="mt-4">
                <Field label="Details" hint="Optional">
                  <textarea className={inputCls + " resize-y min-h-[120px]"} value={message} onChange={(e) => setMessage(e.target.value)}
                    placeholder="Steps you took, what you expected, and what happened. Please do not include passwords." />
                </Field>
              </div>

              {err && <p className="mt-4 text-sm text-red-600">{err}</p>}

              <button type="submit" disabled={status === "submitting"}
                className="help-grad mt-6 w-full rounded-xl text-white font-semibold text-[15px] py-3 transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:translate-y-0 shadow-[0_14px_40px_-12px_rgba(11,42,224,0.6)]">
                {status === "submitting" ? "Sending…" : "Send request"}
              </button>
              <p className="mt-3 text-center text-xs" style={{ color: "var(--ink-3)" }}>
                We only use your details to answer this request. Resumes and candidate data are never shared over support.
              </p>
            </form>

            <div className="mt-8 text-center text-sm" style={{ color: "var(--ink-2)" }}>
              Looking for answers first? Browse the <a href="https://hireaster.com/resources" className="font-medium underline decoration-[color:var(--line)] underline-offset-2 hover:text-[color:var(--brand)]" style={{ color: "var(--ink)" }}>Aster resources</a>.
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between mb-1.5">
        <span className="text-[13px] font-medium" style={{ color: "var(--ink)" }}>{label}</span>
        {hint && <span className="text-xs" style={{ color: "var(--ink-3)" }}>{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Confirmation({ ticketId, email, onAnother }) {
  return (
    <div className="text-center py-6">
      <div className="mx-auto w-14 h-14 rounded-2xl help-grad flex items-center justify-center shadow-[0_14px_40px_-12px_rgba(11,42,224,0.6)]">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      </div>
      <h1 className="help-display mt-6 text-3xl font-bold tracking-tight">Request received</h1>
      <p className="mt-3 text-[15px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
        Thanks. We have logged your request{ticketId ? <> as <span className="font-semibold" style={{ color: "var(--ink)" }}>{ticketId}</span></> : null} and sent a copy to{" "}
        <span className="font-medium" style={{ color: "var(--ink)" }}>{email}</span>. Our team usually replies within one business day.
      </p>
      <div className="mt-8 flex items-center justify-center gap-3">
        <button onClick={onAnother} className="rounded-xl border border-[color:var(--line)] bg-white px-5 py-2.5 text-sm font-medium hover:bg-neutral-50 transition-colors" style={{ color: "var(--ink)" }}>
          Send another request
        </button>
        <a href="https://hireaster.com" className="help-grad rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5">
          Back to Aster
        </a>
      </div>
    </div>
  );
}
