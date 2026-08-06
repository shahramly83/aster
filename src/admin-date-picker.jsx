// A real calendar, instead of the browser's date input.
// ---------------------------------------------------------------------------
// <input type="date"> renders as "dd/mm/yyyy" until it is filled, looks
// different in every browser, and cannot say anything about the dates it is
// offering. This one shows what the admin actually needs to see before picking:
// which days are already blocked, which are weekends the booking page never
// offered anyway, and which fall inside the 3-day lead time.
//
// Dates are handled as plain YYYY-MM-DD strings built from local y/m/d parts.
// Going through Date.toISOString() would shift a Malaysian morning back a day.
//
// Keyboard: arrows move by day, PageUp/PageDown by month, Home/End to the ends
// of the week, Enter or Space selects, Escape closes and returns focus to the
// field. The grid uses one roving tabindex, so Tab leaves the calendar rather
// than walking 42 cells.
import React, { useEffect, useMemo, useRef, useState } from "react";

const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parseIso = (s) => {
  const [y, m, d] = String(s || "").split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};
const startOfDay = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
const addDays = (dt, n) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n);
const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// Monday first: en-GB, and the booking week is a working week.
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const longDate = (dt) => dt.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export default function DatePicker({
  value,                 // "YYYY-MM-DD" or ""
  onChange,
  blockedDays = [],      // ["YYYY-MM-DD"] — already blocked, shown as such
  leadDays = 3,          // the booking page's lead time, drawn as context
  disabled = false,
  placeholder = "Pick a date",
  id = "date-to-block",
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => parseIso(value), [value]);
  const today = useMemo(() => startOfDay(new Date()), []);
  const earliest = useMemo(() => addDays(today, leadDays), [today, leadDays]);
  const blocked = useMemo(() => new Set(blockedDays), [blockedDays]);

  // The day the arrow keys are sitting on. Opens on the selection, else on the
  // first date the booking page could actually offer.
  const [cursor, setCursor] = useState(() => selected || earliest);
  const [view, setView] = useState(() => (selected || earliest));

  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const gridRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const start = selected || earliest;
    setCursor(start);
    setView(start);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Move DOM focus with the cursor so screen readers announce each day, but
  // only while the calendar is open and only inside the grid.
  useEffect(() => {
    if (!open) return;
    const el = gridRef.current?.querySelector('[data-cursor="true"]');
    el?.focus({ preventScroll: true });
  }, [open, cursor]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };

  const pick = (dt) => {
    if (dt < today) return;              // blocking a day that has gone is meaningless
    onChange?.(iso(dt.getFullYear(), dt.getMonth(), dt.getDate()));
    close();
  };

  // 6 rows of 7, always, so the popover does not change height between months
  // and shove the page around underneath it.
  const cells = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7;   // Monday = 0
    const start = addDays(first, -lead);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [view]);

  const onKeyDown = (e) => {
    const jump = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (jump) { e.preventDefault(); const n = addDays(cursor, jump); setCursor(n); setView(n); return; }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const dow = (cursor.getDay() + 6) % 7;
      const n = addDays(cursor, e.key === "Home" ? -dow : 6 - dow);
      setCursor(n); setView(n); return;
    }
    if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const d = e.key === "PageUp" ? -1 : 1;
      const n = new Date(cursor.getFullYear(), cursor.getMonth() + d, Math.min(cursor.getDate(), 28));
      setCursor(n); setView(n); return;
    }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(cursor); return; }
    if (e.key === "Escape") { e.preventDefault(); close(); }
  };

  const shiftMonth = (d) => setView((v) => new Date(v.getFullYear(), v.getMonth() + d, 1));

  const label = selected ? longDate(selected) : placeholder;

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={btnRef} id={id} type="button" disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog" aria-expanded={open}
        className="adm-datefield h-[38px] w-[15.5rem] rounded-lg px-3 text-sm inline-flex items-center gap-2 text-left"
        style={{ border: "1px solid var(--line)", background: "#fff", color: selected ? "var(--ink)" : "var(--ink-3)" }}>
        <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: "var(--ink-3)" }}>
          <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" />
        </svg>
        <span className="truncate flex-1">{selected ? longDate(selected) : placeholder}</span>
      </button>

      {open && (
        <div role="dialog" aria-modal="false" aria-label="Choose a date to block"
          className="adm-cal absolute z-40 mt-2 p-3 rounded-2xl"
          style={{ background: "#fff", border: "1px solid var(--line)", width: 300 }}>

          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month"
              className="adm-cal-nav w-8 h-8 rounded-lg inline-flex items-center justify-center" style={{ color: "var(--ink-2)" }}>
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <div aria-live="polite" className="text-sm font-bold adm-display" style={{ color: "var(--ink)" }}>
              {MONTHS[view.getMonth()]} {view.getFullYear()}
            </div>
            <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month"
              className="adm-cal-nav w-8 h-8 rounded-lg inline-flex items-center justify-center" style={{ color: "var(--ink-2)" }}>
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>

          <div className="grid grid-cols-7 mb-1">
            {DOW.map((d) => (
              <div key={d} className="h-7 inline-flex items-center justify-center text-[11px] font-semibold"
                style={{ color: "var(--ink-3)" }} aria-hidden="true">{d.slice(0, 1)}</div>
            ))}
          </div>

          <div ref={gridRef} role="grid" onKeyDown={onKeyDown} className="grid grid-cols-7 gap-y-0.5">
            {cells.map((dt) => {
              const key = iso(dt.getFullYear(), dt.getMonth(), dt.getDate());
              const outside = dt.getMonth() !== view.getMonth();
              const past = dt < today;
              const isBlocked = blocked.has(key);
              const weekend = dt.getDay() === 0 || dt.getDay() === 6;
              const early = !past && dt < earliest;
              const isSel = sameDay(dt, selected);
              const isToday = sameDay(dt, today);
              const isCursor = sameDay(dt, cursor);

              // Said out loud, because colour alone cannot carry "already
              // blocked" or "the booking page never offered this day".
              const note = isBlocked ? "already blocked"
                : past ? "in the past"
                : weekend ? "weekend, not offered"
                : early ? "inside the lead time"
                : null;

              return (
                <button key={key} type="button" role="gridcell"
                  data-cursor={isCursor ? "true" : undefined}
                  tabIndex={isCursor ? 0 : -1}
                  disabled={past}
                  aria-selected={isSel}
                  aria-current={isToday ? "date" : undefined}
                  aria-label={`${longDate(dt)}${note ? `, ${note}` : ""}`}
                  onClick={() => pick(dt)}
                  className="adm-cal-day h-9 rounded-lg text-[13px] tnum inline-flex items-center justify-center relative"
                  style={{
                    color: isSel ? "#fff"
                      : past ? "var(--ink-3)"
                      : outside ? "var(--ink-3)"
                      : weekend || early ? "var(--ink-3)"
                      : "var(--ink)",
                    background: isSel ? "var(--brand)" : isBlocked ? "var(--warn-soft)" : "transparent",
                    fontWeight: isSel || isToday ? 700 : 500,
                    opacity: past ? 0.45 : outside ? 0.55 : 1,
                    cursor: past ? "not-allowed" : "pointer",
                  }}>
                  {dt.getDate()}
                  {/* Today gets a dot rather than a ring, so it cannot be
                      mistaken for the selection. */}
                  {isToday && !isSel && (
                    <span className="absolute bottom-1 w-1 h-1 rounded-full" style={{ background: "var(--brand)" }} />
                  )}
                  {isBlocked && !isSel && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full" style={{ background: "var(--warn)" }} />
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 mt-2 pt-2" style={{ borderTop: "1px solid var(--line)" }}>
            <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: "var(--ink-3)" }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--warn)" }} /> already blocked
            </span>
            <div className="flex items-center gap-1">
              {value && (
                <button type="button" onClick={() => { onChange?.(""); close(); }}
                  className="adm-cal-foot text-[12px] font-semibold px-2 py-1 rounded-md" style={{ color: "var(--ink-2)" }}>
                  Clear
                </button>
              )}
              <button type="button" onClick={() => { setCursor(earliest); setView(earliest); }}
                className="adm-cal-foot text-[12px] font-semibold px-2 py-1 rounded-md" style={{ color: "var(--brand)" }}>
                Earliest bookable
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
