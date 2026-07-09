// "Ask Aster" — the public marketing-site chat assistant.
//
// A floating bubble that opens a chat panel and answers pre-sales questions
// about Aster, streamed token by token from the `marketing-chat` edge function.
// Mounted on every marketing surface (see resume-ai-preview.jsx). It inherits
// the brand tokens (--brand, --ink*, --line, .brand-gradient) from <Shell>, so
// it needs no styles of its own beyond layout.
//
// If Supabase isn't configured (a fresh clone on mock data) or the function
// isn't deployed yet, it degrades to a short canned reply pointing at the trial
// and sales, so the widget never looks broken.
import { useEffect, useRef, useState, Fragment } from "react";
import { supabase, supabaseUrl, supabaseAnonKey, hasSupabase } from "./lib/supabase";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Persist the conversation + open state for the browsing session, so closing the
// widget just minimizes it (the chat is kept) and the visitor can pick it back up
// on any page. sessionStorage clears when the tab closes, which suits a marketing
// chat. The widget is mounted per page, so every instance reads the same store.
const STORE_KEY = "asterChat.v1";
const STORE_TTL_MS = 60 * 60 * 1000; // drop a conversation after 60 min idle, so it doesn't linger forever
function loadStore() {
  if (typeof window === "undefined") return {};
  try {
    const s = JSON.parse(window.sessionStorage.getItem(STORE_KEY) || "{}") || {};
    if (s.savedAt && Date.now() - s.savedAt > STORE_TTL_MS) {
      window.sessionStorage.removeItem(STORE_KEY);
      return {};
    }
    return s;
  } catch { return {}; }
}

const STARTERS = [
  "What does Aster do?",
  "How much does it cost?",
  "How does the AI match score work?",
  "Is my candidate data secure?",
];

const OFFLINE_REPLY =
  "Thanks for asking. I can tell you about Aster's features, pricing, and security, and I'm best experienced on the live site. In the meantime: Aster reads every resume, scores each applicant against the role, and runs your whole hiring pipeline in one place. You can start free (14 days of Premium, no card) or contact sales for anything custom.";

function ChatIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5Z"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function MarketingChat({ onStartTrial }) {
  const [open, setOpen] = useState(() => !!loadStore().open);
  const [messages, setMessages] = useState(() => loadStore().messages || []); // {role:'user'|'assistant', content}
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Lead capture: null = chatting, "form" = collecting an email, "sent" = filed.
  const [leadMode, setLeadMode] = useState(null);
  const [lead, setLead] = useState({ name: "", email: "", phone: "", msg: "" });
  const [leadBusy, setLeadBusy] = useState(false);
  const [leadErr, setLeadErr] = useState("");
  const [leadRef, setLeadRef] = useState("");
  const hpRef = useRef(null); // honeypot: real people leave it empty
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Stick to the bottom as content streams in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  // Auto-focus the input only on larger screens. On mobile, focusing pops the
  // keyboard immediately and hides the intro/starters, so we let the visitor
  // read first and tap the field when they're ready.
  useEffect(() => {
    if (open && typeof window !== "undefined" && window.innerWidth >= 640) inputRef.current?.focus();
  }, [open]);

  // Save the conversation once it settles (not on every streamed token).
  useEffect(() => {
    if (busy || typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(
        STORE_KEY,
        JSON.stringify({ open, messages: messages.filter((m) => m.content), savedAt: Date.now() })
      );
    } catch { /* storage full or blocked: non-fatal */ }
  }, [open, messages, busy]);

  // End the current conversation and clear what's saved, back to a fresh chat.
  function resetChat() {
    setMessages([]);
    setInput("");
    setLeadMode(null);
    setLead({ name: "", email: "", phone: "", msg: "" });
    setLeadErr("");
    try { window.sessionStorage.removeItem(STORE_KEY); } catch { /* non-fatal */ }
  }

  async function send(text) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput("");
    // Append the user turn plus an empty assistant turn we stream into.
    const history = [...messages, { role: "user", content: q }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setBusy(true);

    // Push a delta onto the in-progress assistant message (always the last one).
    const appendDelta = (delta) =>
      setMessages((prev) => {
        const next = prev.slice();
        const last = next[next.length - 1];
        if (last?.role === "assistant") next[next.length - 1] = { ...last, content: last.content + delta };
        return next;
      });
    const setAssistant = (content) =>
      setMessages((prev) => {
        const next = prev.slice();
        next[next.length - 1] = { role: "assistant", content };
        return next;
      });

    if (!hasSupabase || !supabaseUrl) {
      // No backend wired up: show the canned reply so nothing looks broken.
      setAssistant(OFFLINE_REPLY);
      setBusy(false);
      return;
    }

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/marketing-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({ messages: history }),
      });
      if (!res.ok || !res.body) throw new Error(`bad response ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let got = false;
      let streaming = true;
      while (streaming) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const block = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          for (const line of block.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            try {
              const evt = JSON.parse(payload);
              if (evt.t) { appendDelta(evt.t); got = true; }
              else if (evt.error) throw new Error(evt.error);
              else if (evt.done) streaming = false;
            } catch (err) {
              if (err.message === "stream_failed") throw err;
              // otherwise ignore a stray/partial line
            }
          }
        }
      }
      if (!got) setAssistant(OFFLINE_REPLY);
    } catch {
      setAssistant(
        "Sorry, I couldn't reach the assistant just now. You can start a free trial (14 days, no card) or contact sales, and I'll be right here to help next time."
      );
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function openLead() {
    setLeadErr("");
    setLeadMode("form");
  }

  // File the enquiry as a sales ticket through the same support-intake function
  // the help center uses, so it lands in the admin Support queue and the visitor
  // gets a confirmation email. Attaches the chat transcript for context.
  async function submitLead() {
    const email = lead.email.trim();
    if (!EMAIL_RE.test(email)) { setLeadErr("Please enter a valid email address."); return; }
    if (hpRef.current?.value) { setLeadMode("sent"); setLeadRef(""); return; } // honeypot: silently drop bots
    setLeadBusy(true);
    setLeadErr("");
    const transcript = messages
      .map((m) => `${m.role === "user" ? "Visitor" : "Aster"}: ${m.content}`)
      .join("\n")
      .slice(0, 4000);
    const note = lead.msg.trim();
    const phone = lead.phone.trim();
    const body =
      `Sales enquiry from the marketing chat.` +
      (phone ? `\n\nPhone: ${phone}` : "") +
      (note ? `\n\nMessage:\n${note}` : "") +
      (transcript ? `\n\nChat so far:\n${transcript}` : "");
    try {
      let id = "T-preview";
      if (hasSupabase && supabase) {
        const res = await supabase.functions.invoke("support-intake", {
          body: {
            name: lead.name.trim() || "Website visitor",
            email,
            subject: "[Sales] Marketing chat enquiry",
            body,
            website: "", // honeypot value sent to the RPC (empty = human)
          },
        });
        if (res.error || !res.data?.id) throw new Error(res.error?.message || "failed");
        id = res.data.id;
      }
      setLeadRef(id);
      setLeadMode("sent");
    } catch {
      setLeadErr("Couldn't send that just now. Please try again, or email sales@hireaster.com.");
    } finally {
      setLeadBusy(false);
    }
  }

  const bubbleShadow = "0 18px 44px -14px rgba(var(--brand-rgb),0.55)";
  const fieldCls =
    "w-full rounded-xl bg-white border px-3.5 py-2.5 text-sm outline-none focus:border-[color:var(--brand)] transition-colors";

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Ask Aster"
          className="fixed z-[60] bottom-4 right-4 sm:bottom-6 sm:right-6 flex items-center justify-center gap-2 rounded-full text-white font-semibold text-sm brand-gradient transition-transform hover:-translate-y-0.5 active:translate-y-0 w-14 h-14 sm:w-auto sm:h-auto sm:pl-4 sm:pr-5 sm:py-3.5"
          style={{ boxShadow: bubbleShadow }}
        >
          <ChatIcon className="w-6 h-6 sm:w-5 sm:h-5" />
          <span className="hidden sm:inline">Ask Aster</span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          className="fixed z-[60] inset-0 sm:inset-auto sm:bottom-6 sm:right-6 w-full sm:w-[380px] h-full sm:h-[560px] sm:max-h-[calc(100vh-3rem)] flex flex-col overflow-hidden bg-white sm:rounded-2xl sm:border"
          style={{ borderColor: "var(--line)", boxShadow: "0 30px 70px -24px rgba(18,19,42,0.4)" }}
          role="dialog"
          aria-label="Ask Aster chat"
        >
          {/* Header */}
          <div className="brand-gradient text-white px-4 py-3.5 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center">
                <ChatIcon className="w-4 h-4" />
              </span>
              <div className="leading-tight">
                <p className="font-semibold text-[15px]">Ask Aster</p>
                <p className="text-[11px] text-white/75">Answers about the product, instantly</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button onClick={resetChat} aria-label="Start a new chat" title="New chat" className="h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-[13px] font-medium text-white/90 hover:bg-white/15 transition-colors">
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" aria-hidden="true"><path d="M4 12a8 8 0 1 1 2.3 5.6M4 12V7m0 5h5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  New
                </button>
              )}
              <button onClick={() => setOpen(false)} aria-label="Minimize chat" title="Minimize" className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/15 transition-colors">
                <svg viewBox="0 0 24 24" className="w-4.5 h-4.5" fill="none" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              </button>
            </div>
          </div>

          {/* ---- Lead captured confirmation ---- */}
          {leadMode === "sent" && (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6" style={{ background: "var(--bg)" }}>
              <span className="w-14 h-14 rounded-2xl brand-gradient flex items-center justify-center text-white mb-4">
                <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none" aria-hidden="true"><path d="m5 13 4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <p className="font-semibold text-[17px]" style={{ color: "var(--ink)" }}>Thanks, we'll be in touch</p>
              <p className="text-sm mt-2 leading-relaxed" style={{ color: "var(--ink-2)" }}>
                Our team will reach out by email, usually within one business day.
                {leadRef && leadRef !== "T-preview" ? <> Your reference is <span className="font-semibold" style={{ color: "var(--ink)" }}>{leadRef}</span>.</> : null}
              </p>
              <button
                onClick={() => { setLeadMode(null); setLead({ name: "", email: "", phone: "", msg: "" }); }}
                className="mt-6 text-sm font-semibold" style={{ color: "var(--brand)" }}
              >
                Back to chat
              </button>
            </div>
          )}

          {/* ---- Lead capture form ---- */}
          {leadMode === "form" && (
            <div className="flex-1 overflow-y-auto px-4 py-4" style={{ background: "var(--bg)" }}>
              <button onClick={() => setLeadMode(null)} className="text-[13px] font-medium mb-3 inline-flex items-center gap-1" style={{ color: "var(--ink-3)" }}>
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" aria-hidden="true"><path d="m15 18-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Back
              </button>
              <p className="font-semibold text-[15px]" style={{ color: "var(--ink)" }}>Talk to sales</p>
              <p className="text-sm mt-1 mb-4 leading-relaxed" style={{ color: "var(--ink-2)" }}>
                Leave your work email and a note, and we'll get back to you. We'll include this chat for context.
              </p>
              <div className="space-y-2.5">
                <input
                  value={lead.name}
                  onChange={(e) => setLead((l) => ({ ...l, name: e.target.value }))}
                  placeholder="Name (optional)"
                  className={fieldCls}
                  style={{ borderColor: "var(--line)", color: "var(--ink)" }}
                />
                <input
                  type="email"
                  value={lead.email}
                  onChange={(e) => setLead((l) => ({ ...l, email: e.target.value }))}
                  placeholder="Work email"
                  autoComplete="email"
                  className={fieldCls}
                  style={{ borderColor: "var(--line)", color: "var(--ink)" }}
                />
                <input
                  type="tel"
                  value={lead.phone}
                  onChange={(e) => setLead((l) => ({ ...l, phone: e.target.value }))}
                  placeholder="Contact number (optional)"
                  autoComplete="tel"
                  className={fieldCls}
                  style={{ borderColor: "var(--line)", color: "var(--ink)" }}
                />
                <textarea
                  value={lead.msg}
                  onChange={(e) => setLead((l) => ({ ...l, msg: e.target.value }))}
                  rows={3}
                  placeholder="What are you hoping to do with Aster? (optional)"
                  className={`${fieldCls} resize-none`}
                  style={{ borderColor: "var(--line)", color: "var(--ink)" }}
                />
                {/* Honeypot: hidden from people, catches bots */}
                <input ref={hpRef} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
                {leadErr && <p className="text-[13px]" style={{ color: "#DC2626" }}>{leadErr}</p>}
                <button
                  onClick={submitLead}
                  disabled={leadBusy}
                  className="w-full rounded-xl text-white text-sm font-semibold py-3 brand-gradient transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:translate-y-0"
                >
                  {leadBusy ? "Sending..." : "Send to sales"}
                </button>
              </div>
            </div>
          )}

          {/* Messages */}
          {!leadMode && (<>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ background: "var(--bg)" }}>
            {messages.length === 0 && (
              <div>
                <p className="text-sm leading-relaxed" style={{ color: "var(--ink-2)" }}>
                  Hi, I'm the Aster assistant. Ask me anything about what Aster does, pricing, or how it fits your hiring.
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="text-left text-sm rounded-xl px-3 py-2 bg-white border transition-colors hover:border-[color:var(--brand)]"
                      style={{ borderColor: "var(--line)", color: "var(--ink)" }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${m.role === "user" ? "whitespace-pre-wrap" : ""}`}
                  style={
                    m.role === "user"
                      ? { background: "var(--brand)", color: "#fff", borderBottomRightRadius: 6 }
                      : { background: "#fff", color: "var(--ink)", border: "1px solid var(--line)", borderBottomLeftRadius: 6 }
                  }
                >
                  {m.role === "user"
                    ? m.content
                    : m.content
                      ? renderRich(m.content)
                      : busy && i === messages.length - 1 ? <TypingDots /> : ""}
                </div>
              </div>
            ))}
          </div>

          {/* CTAs */}
          <div className="px-4 pt-3 flex gap-2 shrink-0" style={{ background: "var(--bg)" }}>
            <button
              onClick={() => onStartTrial?.()}
              className="flex-1 rounded-xl text-white text-[13px] font-semibold py-2.5 brand-gradient transition-transform hover:-translate-y-0.5 active:translate-y-0"
            >
              Start free trial
            </button>
            <button
              onClick={openLead}
              className="flex-1 rounded-xl text-[13px] font-semibold py-2.5 bg-white border transition-colors hover:border-[color:var(--brand)]"
              style={{ borderColor: "var(--line-strong)", color: "var(--ink)" }}
            >
              Contact sales
            </button>
          </div>

          {/* Composer */}
          <div className="px-4 py-3 shrink-0" style={{ background: "var(--bg)" }}>
            <div className="flex items-end gap-2 rounded-xl bg-white border px-3 py-2" style={{ borderColor: "var(--line)" }}>
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask about Aster..."
                className="flex-1 resize-none bg-transparent text-sm leading-relaxed outline-none max-h-28"
                style={{ color: "var(--ink)" }}
              />
              <button
                onClick={() => send()}
                disabled={busy || !input.trim()}
                aria-label="Send"
                className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-white brand-gradient transition-opacity disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" aria-hidden="true"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
            <p className="text-[11px] text-center mt-2" style={{ color: "var(--ink-3)" }}>
              Aster's AI can make mistakes. Check important details.
            </p>
          </div>
          </>)}
        </div>
      )}
    </>
  );
}

// Minimal, safe markdown for assistant replies: **bold**, `- `/`* ` and `1.`
// lists, headings, and paragraph spacing. Renders to React nodes (no innerHTML,
// so nothing the model returns can inject markup). Partial markdown that arrives
// mid-stream (e.g. an unclosed "**") just shows as text until it completes.
function inline(text, keyBase) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    const b = part.match(/^\*\*([^*]+)\*\*$/);
    if (b) return <strong key={`${keyBase}-${i}`}>{b[1]}</strong>;
    return <Fragment key={`${keyBase}-${i}`}>{part}</Fragment>;
  });
}

function renderRich(text) {
  const lines = String(text).split("\n");
  const nodes = [];
  let list = null; // { ordered, items: [] }
  let key = 0;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i} className="leading-snug">{inline(it, `li-${key}-${i}`)}</li>);
    nodes.push(
      list.ordered
        ? <ol key={key++} className="list-decimal pl-5 my-1.5 space-y-1">{items}</ol>
        : <ul key={key++} className="list-disc pl-5 my-1.5 space-y-1">{items}</ul>
    );
    list = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+\.\s+(.*)$/);
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (bullet) {
      if (!list || list.ordered) { flush(); list = { ordered: false, items: [] }; }
      list.items.push(bullet[1]);
    } else if (numbered) {
      if (!list || !list.ordered) { flush(); list = { ordered: true, items: [] }; }
      list.items.push(numbered[1]);
    } else if (heading) {
      flush();
      nodes.push(<p key={key++} className="font-semibold mt-2 mb-1 first:mt-0">{inline(heading[1], `h-${key}`)}</p>);
    } else if (line.trim() === "") {
      flush();
    } else {
      flush();
      nodes.push(<p key={key++} className="my-1 first:mt-0 last:mb-0">{inline(line, `p-${key}`)}</p>);
    }
  }
  flush();
  return nodes;
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1 py-1" aria-label="Assistant is typing">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full inline-block"
          style={{ background: "var(--ink-3)", animation: `mcBlink 1.2s ${i * 0.2}s infinite ease-in-out` }}
        />
      ))}
      <style>{`@keyframes mcBlink { 0%, 60%, 100% { opacity: .25 } 30% { opacity: 1 } }`}</style>
    </span>
  );
}
