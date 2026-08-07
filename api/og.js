// The image LinkedIn, WhatsApp and Slack show for a shared job.
// ---------------------------------------------------------------------------
// A company's logo is almost always square, often transparent, and frequently
// small. LinkedIn wants 1200x630 landscape, so a logo used directly gets
// letterboxed onto a background it picks, or rejected for being under their
// minimum. Drawing a card around the logo is the only way to control what a
// share actually looks like.
//
// Edge runtime: @vercel/og renders with satori and resvg in WASM, which the
// Node runtime cannot load.
//
// No JSX. A plain Vite project has no JSX transform for files under /api, so
// React.createElement is used directly rather than adding a build step for one
// file.
import { ImageResponse } from "@vercel/og";
import React from "react";

export const config = { runtime: "edge" };

const BRAND = "#0B2AE0";
const INK = "#12132A";
const INK_2 = "#56566A";

const el = React.createElement;

// Long job titles are the normal case ("Senior Backend Engineer, Platform"),
// so the card shrinks the type rather than truncating: a cut-off role reads as
// a broken link.
const titleSize = (s) => (s.length > 64 ? 46 : s.length > 44 ? 56 : s.length > 28 ? 66 : 76);

export default function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const title = (searchParams.get("title") || "Open role").slice(0, 110);
    const company = (searchParams.get("company") || "").slice(0, 60);
    const meta = (searchParams.get("meta") || "").slice(0, 80);
    const logo = searchParams.get("logo");

    return new ImageResponse(
      el("div", {
        style: {
          height: "100%", width: "100%", display: "flex", flexDirection: "column",
          justifyContent: "space-between", background: "#FFFFFF",
          padding: "64px 72px", fontFamily: "sans-serif",
          // A brand edge so the card is recognisably Aster-powered without
          // putting our name where the company's should be.
          borderLeft: `24px solid ${BRAND}`,
        },
      }, [
        // Header: logo and company name.
        el("div", { key: "h", style: { display: "flex", alignItems: "center", gap: 24 } }, [
          logo
            ? el("img", {
                key: "l", src: logo, width: 84, height: 84,
                style: { objectFit: "contain", borderRadius: 16 },
              })
            : el("div", {
                key: "m",
                style: {
                  width: 84, height: 84, borderRadius: 16, background: "#EAEEFE",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 38, fontWeight: 700, color: BRAND,
                },
              }, (company || "?").trim().charAt(0).toUpperCase()),
          company
            ? el("div", {
                key: "c",
                style: { fontSize: 34, fontWeight: 600, color: INK_2, letterSpacing: "-0.01em" },
              }, company)
            : null,
        ]),

        // The role. The reason anyone clicks, so it gets the most room.
        el("div", { key: "b", style: { display: "flex", flexDirection: "column", gap: 18 } }, [
          el("div", {
            key: "t",
            style: {
              fontSize: titleSize(title), fontWeight: 800, color: INK,
              lineHeight: 1.1, letterSpacing: "-0.03em",
            },
          }, title),
          meta
            ? el("div", { key: "s", style: { fontSize: 30, color: INK_2 } }, meta)
            : null,
        ]),

        el("div", {
          key: "f",
          style: { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 24, color: "#8A8A9A" },
        }, [
          el("div", { key: "a" }, "Apply in a few minutes"),
          el("div", { key: "b2", style: { fontWeight: 600, color: BRAND } }, "hireaster.com"),
        ]),
      ]),
      { width: 1200, height: 630 },
    );
  } catch (e) {
    // A broken card must never take the whole share preview down with it: fall
    // back to the static image rather than returning a 500 the crawler caches.
    return Response.redirect("https://hireaster.com/og-image.svg", 302);
  }
}
