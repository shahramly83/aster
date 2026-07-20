/*
 * Aster Apply Widget
 * ---------------------------------------------------------------------------
 * Drop-in application form a customer embeds on their OWN website. It posts the
 * applicant straight into their Aster workspace, parsed and ranked, using the
 * same public `parse-application` endpoint the Aster-hosted apply page uses.
 *
 * The endpoint is public by design: it is authorised by the job existing and
 * being open, and protected by a per-IP rate limit + honeypot. The Supabase
 * anon key is safe to expose in the browser (it grants no data access on its
 * own); the job id is the only thing that routes applicants to the workspace.
 *
 * USAGE (auto-mount from the script tag):
 *   <div id="aster-apply"></div>
 *   <script src="https://hireaster.com/embed/apply-widget.js"
 *           data-aster-url="https://YOUR-PROJECT.supabase.co"
 *           data-aster-key="YOUR_SUPABASE_ANON_KEY"
 *           data-aster-job="THE-JOB-UUID"
 *           data-aster-target="#aster-apply"
 *           data-aster-source="Company Website"
 *           defer></script>
 *
 * USAGE (programmatic, e.g. many roles on one page):
 *   <script src="https://hireaster.com/embed/apply-widget.js" defer></script>
 *   <div id="aster-apply"></div>
 *   <script>
 *     window.addEventListener('DOMContentLoaded', function () {
 *       AsterApply.mount('#aster-apply', {
 *         supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
 *         anonKey: 'YOUR_SUPABASE_ANON_KEY',
 *         jobId: 'THE-JOB-UUID',
 *         source: 'Company Website',        // optional, shows on the Applicants page
 *         accent: '#5A78F8',                // optional, matches your brand
 *         onSuccess: function (res) {}      // optional callback, res = { candidateId, fit }
 *       });
 *     });
 *   </script>
 */
(function () {
  "use strict";

  var MAX_BYTES = 10 * 1024 * 1024; // 10 MB, same practical ceiling as the app

  // -- file helpers (identical behaviour to the Aster apply page) -------------

  // Strip the "data:...;base64," prefix so only the base64 payload is sent.
  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(",")[1] || ""); };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // Raw-deflate inflate using the browser's built-in DecompressionStream, so a
  // .docx (a ZIP) can be read with no external library.
  async function inflateRaw(bytes) {
    var ds = new DecompressionStream("deflate-raw");
    var stream = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await stream.arrayBuffer());
  }

  // Pull plain text out of word/document.xml inside a .docx. Claude can't read a
  // .docx binary, so Word resumes are sent as text; the untouched file still goes
  // over as original_base64 so recruiters download the real document.
  async function extractDocxText(buf) {
    var dv = new DataView(buf);
    var u8 = new Uint8Array(buf);
    var eocd = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    var count = dv.getUint16(eocd + 10, true);
    var off = dv.getUint32(eocd + 16, true);
    var dec = new TextDecoder();
    var max = Math.min(count, 2000);
    for (var n = 0; n < max; n++) {
      if (off + 46 > u8.length || dv.getUint32(off, true) !== 0x02014b50) break;
      var method = dv.getUint16(off + 10, true);
      var compSize = dv.getUint32(off + 20, true);
      var nameLen = dv.getUint16(off + 28, true);
      var extraLen = dv.getUint16(off + 30, true);
      var commentLen = dv.getUint16(off + 32, true);
      var localOff = dv.getUint32(off + 42, true);
      var name = dec.decode(u8.subarray(off + 46, off + 46 + nameLen));
      off += 46 + nameLen + extraLen + commentLen;
      if (name !== "word/document.xml") continue;
      if (dv.getUint32(localOff, true) !== 0x04034b50) return null;
      var lNameLen = dv.getUint16(localOff + 26, true);
      var lExtraLen = dv.getUint16(localOff + 28, true);
      var dataStart = localOff + 30 + lNameLen + lExtraLen;
      var comp = u8.subarray(dataStart, dataStart + compSize);
      var xmlBytes = method === 0 ? comp.slice() : method === 8 ? await inflateRaw(comp) : null;
      if (!xmlBytes) return null;
      var xml = new TextDecoder().decode(xmlBytes);
      xml = xml.replace(/<w:tab\b[^>]*\/?>/g, "\t").replace(/<w:br\b[^>]*\/?>/g, "\n").replace(/<\/w:p>/g, "\n");
      var text = xml.replace(/<[^>]+>/g, "");
      text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
        .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(Number(d)); });
      text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      return text || null;
    }
    return null;
  }

  function isDocx(file) {
    return file && (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || /\.docx$/i.test(file.name));
  }
  function isPdf(file) {
    return file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name));
  }

  // -- friendly copy for each reason code the endpoint can return -------------
  // (no em dashes, per brand style)
  var MESSAGES = {
    not_a_resume: "That file doesn't look like a resume. Please upload your CV as a PDF or Word (.docx) file.",
    no_email: "We couldn't find an email on your resume. Please make sure your contact email is on the document and try again.",
    not_accepting: "This role isn't accepting applications right now. Please check back later.",
    rate_limited: "Too many attempts from your network. Please wait a minute and try again.",
    "job not open": "This role is closed and no longer accepting applications.",
    "job expired": "The application window for this role has closed.",
    "job not found": "We couldn't find this role. The link may be out of date.",
  };
  function messageFor(code) {
    return MESSAGES[code] || "Something went wrong submitting your application. Please try again in a moment.";
  }

  // -- markup + styles --------------------------------------------------------

  function injectStyles(accent) {
    if (document.getElementById("aster-apply-styles")) return;
    var css = [
      ".aster-apply{font-family:inherit;max-width:440px;color:#1a1a1a}",
      ".aster-apply *{box-sizing:border-box}",
      ".aster-apply label{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}",
      ".aster-apply input[type=text],.aster-apply input[type=email]{width:100%;padding:10px 12px;border:1px solid #d8dae0;border-radius:8px;font-size:14px;font-family:inherit}",
      ".aster-apply input:focus{outline:none;border-color:" + accent + ";box-shadow:0 0 0 3px " + accent + "22}",
      ".aster-apply .aster-drop{margin-top:6px;border:1.5px dashed #cfd2da;border-radius:10px;padding:18px;text-align:center;cursor:pointer;font-size:13px;color:#555;transition:border-color .15s,background .15s}",
      ".aster-apply .aster-drop:hover,.aster-apply .aster-drop.drag{border-color:" + accent + ";background:" + accent + "0a}",
      ".aster-apply .aster-file{font-weight:600;color:#1a1a1a;margin-top:4px}",
      ".aster-apply button{margin-top:18px;width:100%;padding:12px;border:0;border-radius:8px;background:" + accent + ";color:#fff;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit}",
      ".aster-apply button:disabled{opacity:.55;cursor:default}",
      ".aster-apply .aster-msg{margin-top:12px;font-size:13px;padding:10px 12px;border-radius:8px;line-height:1.45}",
      ".aster-apply .aster-msg.err{background:#fdecec;color:#a12020}",
      ".aster-apply .aster-msg.ok{background:#eaf7ee;color:#1c7a3d}",
      // Honeypot: never visible to a human, never focusable, off the layout.
      ".aster-apply .aster-hp{position:absolute!important;left:-9999px!important;width:1px;height:1px;opacity:0;pointer-events:none}",
      ".aster-apply .aster-powered{margin-top:12px;font-size:11px;color:#9096a2;text-align:center}",
      ".aster-apply .aster-powered a{color:#9096a2}",
    ].join("");
    var el = document.createElement("style");
    el.id = "aster-apply-styles";
    el.textContent = css;
    document.head.appendChild(el);
  }

  var uid = 0;

  function mount(target, cfg) {
    var root = typeof target === "string" ? document.querySelector(target) : target;
    if (!root) { console.error("[AsterApply] mount target not found:", target); return; }
    if (!cfg || !cfg.supabaseUrl || !cfg.anonKey || !cfg.jobId) {
      console.error("[AsterApply] supabaseUrl, anonKey and jobId are all required.");
      root.textContent = "Apply form misconfigured.";
      return;
    }
    var accent = cfg.accent || "#5A78F8";
    injectStyles(accent);

    var id = "aster" + (++uid);
    root.classList.add("aster-apply");
    // Resume-only: the endpoint reads the applicant's name, email, phone and the
    // rest straight from the CV, so asking for them again would be redundant. Just
    // take the file.
    root.innerHTML =
      '<label>Apply with your resume</label>' +
      '<div class="aster-drop" id="' + id + '-drop">Click to upload or drop your resume here' +
        '<div class="aster-file" id="' + id + '-file"></div>' +
        '<div style="font-size:11px;color:#9096a2;margin-top:4px">PDF or Word (.docx), up to 10 MB</div>' +
      '</div>' +
      '<input id="' + id + '-input" type="file" accept=".pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style="display:none">' +
      // Honeypot field: a real applicant never sees or fills it. Any value marks
      // the submission as a bot; the endpoint drops it but answers 200.
      '<input class="aster-hp" type="text" id="' + id + '-website" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<button id="' + id + '-submit" type="button">Submit application</button>' +
      '<div class="aster-msg" id="' + id + '-msg" style="display:none"></div>' +
      '<div class="aster-powered">Powered by <a href="https://hireaster.com" target="_blank" rel="noopener">Aster</a></div>';

    var $ = function (s) { return root.querySelector("#" + id + "-" + s); };
    var fileInput = $("input"),
        drop = $("drop"), fileLabel = $("file"), submitBtn = $("submit"),
        msg = $("msg"), hp = $("website");
    var chosen = null;

    function showMsg(kind, text) {
      msg.className = "aster-msg " + kind;
      msg.textContent = text;
      msg.style.display = "block";
    }
    function clearMsg() { msg.style.display = "none"; }

    function pick(file) {
      if (!file) return;
      if (!isPdf(file) && !isDocx(file)) {
        showMsg("err", "Please upload a PDF or Word (.docx) file. Older .doc files aren't supported.");
        return;
      }
      if (file.size > MAX_BYTES) {
        showMsg("err", "That file is over 10 MB. Please upload a smaller PDF or .docx.");
        return;
      }
      clearMsg();
      chosen = file;
      fileLabel.textContent = file.name;
    }

    drop.addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", function (e) { pick(e.target.files[0]); });
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("drag"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("drag"); });
    });
    drop.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]);
    });

    submitBtn.addEventListener("click", async function () {
      clearMsg();
      if (!chosen) { showMsg("err", "Please attach your resume."); return; }

      submitBtn.disabled = true;
      var label = submitBtn.textContent;
      submitBtn.textContent = "Submitting...";

      try {
        var body;
        if (isDocx(chosen)) {
          var text = await extractDocxText(await chosen.arrayBuffer());
          if (!text) {
            showMsg("err", "We couldn't read that Word file. Please save it as a PDF and try again.");
            return;
          }
          body = {
            job_id: cfg.jobId,
            resume_text: text,
            original_base64: await fileToBase64(chosen),
            original_ext: "docx",
            filename: chosen.name,
            source: cfg.source || "Company Website",
            website: hp.value, // honeypot
          };
        } else {
          body = {
            job_id: cfg.jobId,
            resume_base64: await fileToBase64(chosen),
            filename: chosen.name,
            source: cfg.source || "Company Website",
            website: hp.value, // honeypot
          };
        }

        var res = await fetch(cfg.supabaseUrl.replace(/\/$/, "") + "/functions/v1/parse-application", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": cfg.anonKey,
            "Authorization": "Bearer " + cfg.anonKey,
          },
          body: JSON.stringify(body),
        });
        var data = {};
        try { data = await res.json(); } catch (e) { /* non-JSON */ }

        if (res.ok && data && data.ok) {
          root.innerHTML = '<div class="aster-msg ok" style="display:block">Thanks. Your application is in and the team will be in touch about next steps.</div>' +
            '<div class="aster-powered">Powered by <a href="https://hireaster.com" target="_blank" rel="noopener">Aster</a></div>';
          if (typeof cfg.onSuccess === "function") {
            try { cfg.onSuccess({ candidateId: data.candidate_id, fit: data.fit }); } catch (e) {}
          }
          return;
        }
        showMsg("err", messageFor((data && data.error) || ""));
      } catch (e) {
        console.error("[AsterApply]", e);
        showMsg("err", "We couldn't reach the server. Please check your connection and try again.");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = label;
      }
    });
  }

  // Auto-mount when the loading <script> carries data-aster-job.
  function autoMount() {
    var s = document.currentScript;
    if (!s) return;
    var job = s.getAttribute("data-aster-job");
    if (!job) return;
    var run = function () {
      mount(s.getAttribute("data-aster-target") || "#aster-apply", {
        supabaseUrl: s.getAttribute("data-aster-url"),
        anonKey: s.getAttribute("data-aster-key"),
        jobId: job,
        source: s.getAttribute("data-aster-source") || "Company Website",
        accent: s.getAttribute("data-aster-accent") || undefined,
      });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
    else run();
  }

  window.AsterApply = { mount: mount };
  autoMount();
})();
