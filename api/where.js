// Supabase Edge Function: no. Vercel Edge Function: where the viewer is.
// ---------------------------------------------------------------------------
// Vercel resolves the caller's approximate location from their IP and attaches
// it to every request, so the dashboard clock and weather can follow whoever is
// looking without ever showing a browser permission prompt. Asking someone to
// grant location access so a card can say "72°F" is a poor trade; this costs
// them nothing and they are never interrupted.
//
// IP geolocation is city-accurate at best and simply wrong behind a VPN. The
// caller treats every field as a hint: no city means no weather, and the card
// falls back to the workspace's own.
//
// Returns nothing that the request did not already carry about itself, so there
// is no auth here: a visitor learning their own approximate city is not a leak.
export const config = { runtime: "edge" };

export default function handler(req) {
  const h = req.headers;
  const dec = (v) => { try { return v ? decodeURIComponent(v) : null; } catch { return v || null; } };
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

  return new Response(JSON.stringify({
    city: dec(h.get("x-vercel-ip-city")),
    region: dec(h.get("x-vercel-ip-country-region")),
    country: h.get("x-vercel-ip-country") || null,
    latitude: num(h.get("x-vercel-ip-latitude")),
    longitude: num(h.get("x-vercel-ip-longitude")),
    // The IANA zone Vercel derived, which is what the clock needs. Absent on
    // some edges, in which case the browser's own zone is the better guess.
    timezone: h.get("x-vercel-ip-timezone") || null,
  }), {
    headers: {
      "content-type": "application/json",
      // Per-viewer, so it must never be shared by a CDN cache. Private and brief:
      // long enough that a reload does not re-resolve, short enough to follow
      // someone onto a plane.
      "cache-control": "private, max-age=600",
      "access-control-allow-origin": "*",
    },
  });
}
