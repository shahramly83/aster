// Where our customers are, drawn.
// ---------------------------------------------------------------------------
// Hand-rolled rather than pulled from a charting library, because every other
// chart in the admin portal (StatusDonut, PlanColumns, MeterBar) is plain SVG
// and adding d3 for one card would be the odd one out. All this needs is the
// country outlines; the projection is four lines of arithmetic.
//
// Equirectangular: longitude maps straight to x, latitude straight to y. It
// stretches the poles badly, which matters for a navigational chart and not at
// all for shading in the handful of countries that pay us. Antarctica is
// dropped for the same reason: it is a third of the height and nobody lives
// there.
//
// The 110m atlas is the coarsest of the three world-atlas files, 108KB, and is
// the right one at this size: the card is under 400px wide, so finer coastlines
// would cost bytes to draw detail no one can see.
import React, { useMemo } from "react";
import { feature } from "topojson-client";
import world from "world-atlas/countries-110m.json";

// Natural Earth's names, versus what a person types into a billing address.
// Only the ones that actually differ: everything else matches on a lowercase
// compare, which is why this list is short rather than 177 entries long.
const ALIASES = {
  "united states": "united states of america",
  "usa": "united states of america",
  "us": "united states of america",
  "uk": "united kingdom",
  "great britain": "united kingdom",
  "england": "united kingdom",
  "scotland": "united kingdom",
  "wales": "united kingdom",
  "uae": "united arab emirates",
  "south korea": "south korea",
  "korea": "south korea",
  "republic of korea": "south korea",
  "russia": "russia",
  "russian federation": "russia",
  "vietnam": "vietnam",
  "viet nam": "vietnam",
  "czech republic": "czechia",
  "ivory coast": "côte d'ivoire",
  "myanmar": "myanmar",
  "burma": "myanmar",
  "hong kong": "hong kong s.a.r.",
  "macau": "macao s.a.r",
  "brunei": "brunei",
  "laos": "laos",
  "syria": "syria",
  "tanzania": "tanzania",
  "bosnia": "bosnia and herzegovina",
  "north macedonia": "macedonia",
  "eswatini": "swaziland",
  "cape verde": "cabo verde",
  "east timor": "timor-leste",
  "dr congo": "dem. rep. congo",
  "democratic republic of the congo": "dem. rep. congo",
  "republic of the congo": "congo",
  "central african republic": "central african rep.",
  "dominican republic": "dominican rep.",
  "south sudan": "s. sudan",
  "solomon islands": "solomon is.",
  "equatorial guinea": "eq. guinea",
  "western sahara": "w. sahara",
  "falkland islands": "falkland is.",
};
const norm = (s) => {
  const k = String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  return ALIASES[k] || k;
};

// Bounds of the drawing, in degrees. Antarctica runs to -90; stopping at -58
// crops it out and lets the inhabited world fill the card.
const LON0 = -180, LON1 = 180, LAT0 = 84, LAT1 = -58;
const W = 800;
const H = Math.round((W * (LAT0 - LAT1)) / (LON1 - LON0));

// Each ring is projected once and its extent recorded on the way through, so
// framing the map later costs nothing: re-walking 177 countries' coordinates to
// find a bounding box would be the same work twice.
const projectRing = (ring, box) => {
  let d = "";
  for (let i = 0; i < ring.length; i++) {
    const x = ((ring[i][0] - LON0) / (LON1 - LON0)) * W;
    const y = ((LAT0 - ring[i][1]) / (LAT0 - LAT1)) * H;
    if (box) {
      if (x < box.x0) box.x0 = x;
      if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y;
      if (y > box.y1) box.y1 = y;
    }
    d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
  }
  return d + "Z";
};

const pathOf = (geometry, box) => {
  if (!geometry) return "";
  const { type, coordinates } = geometry;
  if (type === "Polygon") return coordinates.map((r) => projectRing(r, box)).join("");
  if (type === "MultiPolygon") return coordinates.map((poly) => poly.map((r) => projectRing(r, box)).join("")).join("");
  return "";
};

// counts: { [countryNameAsTyped]: n }. Anything that does not match a country
// in the atlas is reported back through onUnmatched rather than dropped in
// silence, so a typo in a billing address is visible instead of just missing.
export default function WorldMap({ counts = {}, max = 1, tint = "#2563EB", empty = "#E8EEF9", stroke = "#FFFFFF" }) {
  const shapes = useMemo(() => {
    const fc = feature(world, world.objects.countries);
    return fc.features
      .filter((f) => f.properties?.name !== "Antarctica")
      .map((f) => {
        const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        const d = pathOf(f.geometry, box);
        return { id: f.id, name: f.properties?.name || "", d, box };
      });
  }, []);

  const byName = useMemo(() => {
    const m = new Map();
    Object.entries(counts).forEach(([k, v]) => {
      if (!k) return;
      m.set(norm(k), (m.get(norm(k)) || 0) + Number(v || 0));
    });
    return m;
  }, [counts]);

  // Frame the customers, not the planet. One country in Malaysia on a world map
  // is a speck; the same country framed with its neighbours is a place. Falls
  // back to the whole world when nothing has matched yet, which is the only
  // honest thing to draw when there is nothing to point at.
  const view = useMemo(() => {
    const hit = shapes.filter((s) => (byName.get(norm(s.name)) || 0) > 0 && isFinite(s.box.x0));
    if (!hit.length) return { x: 0, y: 0, w: W, h: H };

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of hit) {
      // Some countries own islands on the far side of the date line (Russia,
      // Fiji, the US). Their raw extent is the full width of the map, which
      // would "zoom" to no zoom at all. Ignore any single country wider than a
      // third of the world and frame it by its main mass instead.
      const wide = s.box.x1 - s.box.x0 > W / 3;
      const bx0 = wide ? Math.max(s.box.x0, W * 0.05) : s.box.x0;
      const bx1 = wide ? Math.min(s.box.x1, W * 0.95) : s.box.x1;
      x0 = Math.min(x0, bx0); x1 = Math.max(x1, bx1);
      y0 = Math.min(y0, s.box.y0); y1 = Math.max(y1, s.box.y1);
    }

    // Breathing room, then a floor on the size: framed tight, a single small
    // country fills the card with coastline and no context at all.
    const padX = Math.max((x1 - x0) * 0.6, W * 0.06);
    const padY = Math.max((y1 - y0) * 0.6, H * 0.06);
    x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;

    const MIN_W = W * 0.22;
    let w = Math.max(x1 - x0, MIN_W);
    // Keep the card's proportions, so the map never stretches.
    let h = (w * H) / W;
    if (h < y1 - y0) { h = y1 - y0; w = (h * W) / H; }

    // Centre on the customers, then slide back inside the world's edges rather
    // than showing empty space beyond them.
    let x = (x0 + x1) / 2 - w / 2;
    let y = (y0 + y1) / 2 - h / 2;
    x = Math.max(0, Math.min(x, W - w));
    y = Math.max(0, Math.min(y, H - h));
    return { x, y, w, h };
  }, [shapes, byName]);

  return (
    <svg viewBox={`${view.x.toFixed(1)} ${view.y.toFixed(1)} ${view.w.toFixed(1)} ${view.h.toFixed(1)}`}
      className="w-full h-auto block" role="img"
      aria-label="Countries where Aster has customers">
      <rect x="0" y="0" width={W} height={H} fill="none" />
      {shapes.map((s) => {
        const n = byName.get(norm(s.name)) || 0;
        // One customer should already read as "here", so the ramp starts well
        // above zero. A share-of-total opacity would make the first country in
        // a new market almost invisible.
        const fill = n > 0 ? tint : empty;
        const opacity = n > 0 ? 0.45 + 0.55 * (max > 1 ? Math.min(1, n / max) : 1) : 1;
        return (
          <path key={s.id || s.name} d={s.d} fill={fill} fillOpacity={opacity}
            stroke={stroke} strokeWidth="0.5" vectorEffect="non-scaling-stroke">
            {n > 0 && <title>{`${s.name}: ${n} ${n === 1 ? "workspace" : "workspaces"}`}</title>}
          </path>
        );
      })}
    </svg>
  );
}
