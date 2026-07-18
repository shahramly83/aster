// Relative-time helpers, mirrored from resume-ai-preview.jsx so timestamps read
// the same on both clients.

// "just now" | "12m ago" | "3h ago" | "5d ago"
export function relTime(iso) {
  if (!iso) return "";
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// "today" | "3d ago"
export function relDaysAgo(iso) {
  if (!iso) return "today";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days <= 0 ? "today" : `${days}d ago`;
}

// Short local day + time, e.g. "Tue 8 Jul, 2:00 PM". Used on interview cards.
export function fmtInterviewTime(iso, timeZone) {
  if (!iso) return "";
  const d = new Date(iso);
  const opts = { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
  if (timeZone) opts.timeZone = timeZone;
  return new Intl.DateTimeFormat(undefined, opts).format(d);
}

// "Tue, 21 Jul, 9:00 – 10:00 am" — a full interview window. Falls back to a
// single time when there's no end. Both ends render in the same time zone.
export function fmtInterviewRange(startIso, endIso, timeZone) {
  if (!startIso) return "";
  if (!endIso) return fmtInterviewTime(startIso, timeZone);
  const dateOpts = { weekday: "short", day: "numeric", month: "short" };
  const timeOpts = { hour: "numeric", minute: "2-digit" };
  if (timeZone) { dateOpts.timeZone = timeZone; timeOpts.timeZone = timeZone; }
  const s = new Date(startIso), e = new Date(endIso);
  const date = new Intl.DateTimeFormat(undefined, dateOpts).format(s);
  const start = new Intl.DateTimeFormat(undefined, timeOpts).format(s);
  const end = new Intl.DateTimeFormat(undefined, timeOpts).format(e);
  return `${date}, ${start} – ${end}`;
}

// Minutes until an ISO instant (negative once it's in the past).
export function minutesUntil(iso) {
  if (!iso) return Infinity;
  return Math.round((new Date(iso).getTime() - Date.now()) / 60000);
}
