/*
 * Aster Job Board Widget
 * ---------------------------------------------------------------------------
 * Renders a company's LIVE list of open roles on their own website, straight
 * from their Aster workspace, with no hardcoded job ids. New roles appear as
 * soon as they're opened in Aster; closed / expired roles drop off. Clicking a
 * role expands the Aster apply form (apply-widget.js) inline, so an applicant
 * never leaves the customer's page.
 *
 * Data comes from two public, anon-safe RPCs:
 *   workspace_by_slug(p_slug)  -> company name + logo for the header
 *   list_public_jobs(p_slug)   -> the open roles (migration 0121)
 *
 * USAGE (auto-mount from the script tag):
 *   <div id="aster-board"></div>
 *   <script src="https://hireaster.com/embed/board-widget.js"
 *           data-aster-url="https://YOUR-PROJECT.supabase.co"
 *           data-aster-key="YOUR_SUPABASE_ANON_KEY"
 *           data-aster-slug="your-workspace-slug"
 *           data-aster-target="#aster-board"
 *           data-aster-source="Careers Page"
 *           defer></script>
 *
 * USAGE (programmatic):
 *   AsterBoard.mount('#aster-board', {
 *     supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
 *     anonKey: 'YOUR_SUPABASE_ANON_KEY',
 *     slug: 'your-workspace-slug',
 *     source: 'Careers Page',   // optional
 *     accent: '#5A78F8',        // optional
 *   });
 */
(function () {
  "use strict";

  // Where this script is served from, so we can load apply-widget.js beside it.
  var SELF_SRC = (document.currentScript && document.currentScript.src) || "";
  function applyWidgetUrl() {
    try { return SELF_SRC.replace(/board-widget\.js(\?.*)?$/, "apply-widget.js"); }
    catch (e) { return "/embed/apply-widget.js"; }
  }

  // Load apply-widget.js once, on demand (only when someone clicks Apply).
  var applyLoading = null;
  function ensureApplyWidget() {
    if (window.AsterApply) return Promise.resolve();
    if (applyLoading) return applyLoading;
    applyLoading = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = applyWidgetUrl();
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return applyLoading;
  }

  // -- one PostgREST RPC call (no supabase-js dependency) ---------------------
  async function rpc(cfg, fn, body) {
    var res = await fetch(cfg.supabaseUrl.replace(/\/$/, "") + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": cfg.anonKey,
        "Authorization": "Bearer " + cfg.anonKey,
      },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) throw new Error(fn + " failed: " + res.status);
    return res.json();
  }

  // -- role metadata helpers (fields live in the job's `details` jsonb) -------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function salaryLabel(d) {
    if (!d.salary_min && !d.salary_max) return null;
    var cur = d.salary_currency || "";
    var fmt = function (n) { return Number(n).toLocaleString(); };
    if (d.salary_min && d.salary_max) {
      if (d.salary_min === d.salary_max) return (cur + " " + fmt(d.salary_min)).trim();
      return (cur + " " + fmt(d.salary_min) + "-" + fmt(d.salary_max)).trim();
    }
    return (cur + " " + fmt(d.salary_min || d.salary_max) + "+").trim();
  }

  function chipsFor(d) {
    var seniority = (d.seniority_levels && d.seniority_levels.length)
      ? d.seniority_levels.join(" / ")
      : d.seniority_level;
    return [
      d.department,
      d.location,
      d.employment_type ? String(d.employment_type).replace(/_/g, "-") : null,
      d.remote_type,
      seniority,
      salaryLabel(d),
    ].filter(Boolean);
  }

  // Human closing note, kept quiet unless the role is closing soon.
  function closingNote(expires_at) {
    if (!expires_at) return null;
    var end = new Date(expires_at + "T00:00:00Z").getTime();
    var days = Math.ceil((end - Date.now()) / 86400000);
    if (isNaN(days) || days < 0 || days > 14) return null;
    if (days === 0) return "Closes today";
    if (days === 1) return "Closes tomorrow";
    return "Closes in " + days + " days";
  }

  // -- styles -----------------------------------------------------------------
  function injectStyles(accent) {
    if (document.getElementById("aster-board-styles")) return;
    var css = [
      ".aster-board{font-family:inherit;max-width:720px;color:#1a1a1a}",
      ".aster-board *{box-sizing:border-box}",
      ".aster-board .ab-head{display:flex;align-items:center;gap:12px;margin-bottom:20px}",
      ".aster-board .ab-head img{height:36px;width:auto;border-radius:6px}",
      ".aster-board .ab-head h2{font-size:20px;margin:0;font-weight:700}",
      ".aster-board .ab-role{border:1px solid #e6e8ee;border-radius:12px;padding:18px 20px;margin-bottom:12px;transition:border-color .15s,box-shadow .15s}",
      ".aster-board .ab-role:hover{border-color:" + accent + ";box-shadow:0 2px 10px rgba(20,25,40,.06)}",
      ".aster-board .ab-top{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}",
      ".aster-board .ab-title{font-size:16px;font-weight:650;margin:0}",
      ".aster-board .ab-chips{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px}",
      ".aster-board .ab-chip{font-size:12px;color:#4b5162;background:#f1f3f7;border-radius:999px;padding:3px 10px}",
      ".aster-board .ab-close{font-size:11px;color:#a15a12;background:#fff3e6;border-radius:999px;padding:3px 10px}",
      ".aster-board .ab-apply{flex:0 0 auto;border:0;border-radius:8px;background:" + accent + ";color:#fff;font-size:13px;font-weight:600;padding:9px 16px;cursor:pointer;font-family:inherit}",
      ".aster-board .ab-apply.secondary{background:#f1f3f7;color:#1a1a1a}",
      ".aster-board .ab-apply:disabled{opacity:.5;cursor:default}",
      ".aster-board .ab-form{margin-top:16px;padding-top:16px;border-top:1px solid #eef0f4}",
      ".aster-board .ab-empty,.aster-board .ab-error{padding:28px;text-align:center;color:#6b7280;border:1px dashed #d8dae0;border-radius:12px}",
      ".aster-board .ab-powered{margin-top:14px;font-size:11px;color:#9096a2;text-align:center}",
      ".aster-board .ab-powered a{color:#9096a2}",
    ].join("");
    var el = document.createElement("style");
    el.id = "aster-board-styles";
    el.textContent = css;
    document.head.appendChild(el);
  }

  var uid = 0;

  async function mount(target, cfg) {
    var root = typeof target === "string" ? document.querySelector(target) : target;
    if (!root) { console.error("[AsterBoard] mount target not found:", target); return; }
    if (!cfg || !cfg.supabaseUrl || !cfg.anonKey || !cfg.slug) {
      console.error("[AsterBoard] supabaseUrl, anonKey and slug are all required.");
      root.textContent = "Job board misconfigured.";
      return;
    }
    var accent = cfg.accent || "#5A78F8";
    injectStyles(accent);
    root.classList.add("aster-board");
    root.innerHTML = '<div class="ab-empty">Loading open roles...</div>';

    var company, jobs;
    try {
      var out = await Promise.all([
        rpc(cfg, "workspace_by_slug", { p_slug: cfg.slug }),
        rpc(cfg, "list_public_jobs", { p_slug: cfg.slug }),
      ]);
      company = Array.isArray(out[0]) ? out[0][0] : out[0];
      jobs = Array.isArray(out[1]) ? out[1] : [];
    } catch (e) {
      console.error("[AsterBoard]", e);
      root.innerHTML = '<div class="ab-error">We couldn\'t load open roles right now. Please try again shortly.</div>';
      return;
    }

    var head = "";
    if (company) {
      head = '<div class="ab-head">' +
        (company.logo_url ? '<img src="' + esc(company.logo_url) + '" alt="">' : "") +
        "<h2>" + esc((company.name || "") + " open roles").trim() + "</h2></div>";
    }

    if (!jobs.length) {
      root.innerHTML = head + '<div class="ab-empty">No open roles right now. Please check back soon.</div>' + poweredBy();
      return;
    }

    var id = "ab" + (++uid);
    var rows = jobs.map(function (j, i) {
      var d = j.details || {};
      var chips = chipsFor(d).map(function (c) { return '<span class="ab-chip">' + esc(c) + "</span>"; });
      var close = closingNote(j.expires_at);
      if (close) chips.push('<span class="ab-close">' + esc(close) + "</span>");
      var canApply = j.accepting !== false;
      return '<div class="ab-role" data-job="' + esc(j.id) + '" data-i="' + i + '">' +
        '<div class="ab-top">' +
          '<div><p class="ab-title">' + esc(j.title) + "</p>" +
            (chips.length ? '<div class="ab-chips">' + chips.join("") + "</div>" : "") +
          "</div>" +
          (canApply
            ? '<button class="ab-apply" id="' + id + "-btn-" + i + '" data-i="' + i + '">Apply</button>'
            : '<button class="ab-apply" disabled title="Not accepting applications">Closed</button>') +
        "</div>" +
        '<div class="ab-form" id="' + id + "-form-" + i + '" style="display:none"></div>' +
      "</div>";
    }).join("");

    root.innerHTML = head + rows + poweredBy();

    // Wire up each Apply button: toggle an inline apply form for that role.
    jobs.forEach(function (j, i) {
      if (j.accepting === false) return;
      var btn = document.getElementById(id + "-btn-" + i);
      var formEl = document.getElementById(id + "-form-" + i);
      var mounted = false;
      btn.addEventListener("click", async function () {
        var open = formEl.style.display !== "none";
        if (open) {
          formEl.style.display = "none";
          btn.textContent = "Apply";
          btn.classList.remove("secondary");
          return;
        }
        formEl.style.display = "block";
        btn.textContent = "Close";
        btn.classList.add("secondary");
        if (!mounted) {
          try {
            await ensureApplyWidget();
            window.AsterApply.mount(formEl, {
              supabaseUrl: cfg.supabaseUrl,
              anonKey: cfg.anonKey,
              jobId: j.id,
              source: cfg.source || "Careers Page",
              accent: accent,
              onSuccess: cfg.onSuccess,
            });
            mounted = true;
          } catch (e) {
            console.error("[AsterBoard] apply widget failed to load", e);
            formEl.innerHTML = '<div class="ab-error">Couldn\'t load the apply form. Please refresh and try again.</div>';
          }
        }
      });
    });
  }

  function poweredBy() {
    return '<div class="ab-powered">Powered by <a href="https://hireaster.com" target="_blank" rel="noopener">Aster</a></div>';
  }

  function autoMount() {
    var s = document.currentScript;
    if (!s) return;
    var slug = s.getAttribute("data-aster-slug");
    if (!slug) return;
    var run = function () {
      mount(s.getAttribute("data-aster-target") || "#aster-board", {
        supabaseUrl: s.getAttribute("data-aster-url"),
        anonKey: s.getAttribute("data-aster-key"),
        slug: slug,
        source: s.getAttribute("data-aster-source") || "Careers Page",
        accent: s.getAttribute("data-aster-accent") || undefined,
      });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
    else run();
  }

  window.AsterBoard = { mount: mount };
  autoMount();
})();
