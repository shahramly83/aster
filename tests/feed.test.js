// The feed is machine-read by third parties on a schedule we do not control,
// and a malformed file is rejected silently: no error reaches us, the roles
// just stop appearing. So the things worth pinning down are the ones that break
// the whole document rather than one field.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import handler from "../api/feed.js";

const JOB = {
  id: "11111111-2222-3333-4444-555555555555",
  title: "Warehouse Supervisor",
  details: {
    location: "Shah Alam, Selangor",
    employment_type: "full_time",
    work_mode: "onsite",
    department: "Operations",
    salary_min: 4000, salary_max: 5500, salary_currency: "myr",
    description: "We move stock for a living.\n\nYou will own the evening shift.",
    responsibilities: ["Run the evening shift"],
    requirements: ["Three years in a warehouse"],
    benefits: ["EPF and SOCSO contributions"],
  },
  expires_at: "2026-12-31",
  created_at: "2026-08-01T02:00:00.000Z",
  company_name: "Acme Logistics",
  company_slug: "acme",
  logo_url: null,
  address_city: "Petaling Jaya",
  address_state: "Selangor",
  address_country: "MY",
};

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(v) { this.body = v ?? ""; return this; },
  };
}

const run = async (query = {}) => {
  const res = mockRes();
  await handler({ headers: { host: "hireaster.com" }, query }, res);
  return res;
};

// Strip CDATA, then walk the tags. Catches the failure that matters most: a
// description containing "]]>" ending its own block early and leaving the rest
// of the document as stray markup.
function tagsBalance(xml) {
  const stripped = xml.replace(/<!\[CDATA\[[\s\S]*?]]>/g, "");
  const stack = [];
  for (const m of stripped.matchAll(/<\/?([a-zA-Z][\w.-]*)[^>]*?(\/?)>/g)) {
    const [full, name, selfClose] = m;
    if (full.startsWith("<?") || selfClose) continue;
    if (full.startsWith("</")) { if (stack.pop() !== name) return false; }
    else stack.push(name);
  }
  return stack.length === 0;
}

let rows;
beforeEach(() => {
  rows = [JOB];
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => rows })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("job feed", () => {
  it("renders a well-formed source-dialect document", async () => {
    const { statusCode, body, headers } = await run();
    expect(statusCode).toBe(200);
    expect(headers["content-type"]).toMatch(/application\/xml/);
    expect(body.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(body).toContain("<source>");
    expect(body).toContain("<publisher><![CDATA[Aster]]></publisher>");
    expect(tagsBalance(body)).toBe(true);
  });

  it("renders a well-formed jooble-dialect document", async () => {
    const { body } = await run({ dialect: "jooble" });
    expect(body).toContain("<jobs>");
    expect(body).toContain("<name><![CDATA[Warehouse Supervisor]]></name>");
    expect(tagsBalance(body)).toBe(true);
  });

  // The description is HTML-escaped on the way in, so "]]>" cannot survive to
  // close its own block there. The title, company name and location are not:
  // they go into CDATA verbatim, which makes them the field that can actually
  // end the document early and orphan every job after it.
  it("keeps a CDATA terminator in a title from breaking the document", async () => {
    rows = [{ ...JOB, title: "Engineer ]]> Nights" }];
    const { body } = await run();
    expect(body).toContain("]]]]><![CDATA[>");
    expect(tagsBalance(body)).toBe(true);
  });

  it("keeps the description's own escaping intact", async () => {
    rows = [{ ...JOB, details: { ...JOB.details, description: "Bracket soup ]]> and more" } }];
    const { body } = await run();
    expect(body).toContain("Bracket soup ]]&gt; and more");
    expect(tagsBalance(body)).toBe(true);
  });

  it("escapes markup typed into a description", async () => {
    rows = [{ ...JOB, details: { ...JOB.details, description: "R&D for <b>bold</b> people" } }];
    const { body } = await run();
    expect(body).toContain("R&amp;D for &lt;b&gt;bold&lt;/b&gt; people");
    expect(tagsBalance(body)).toBe(true);
  });

  it("splits the location and falls back to the company address", async () => {
    const { body } = await run();
    expect(body).toContain("<city><![CDATA[Shah Alam]]></city>");
    expect(body).toContain("<state><![CDATA[Selangor]]></state>");
    expect(body).toContain("<country><![CDATA[MY]]></country>");
  });

  it("does not file a remote role under a city called Remote", async () => {
    rows = [{ ...JOB, details: { ...JOB.details, location: "Remote", work_mode: "remote" } }];
    const { body } = await run();
    expect(body).toContain("<city><![CDATA[Petaling Jaya]]></city>");
    expect(body).toContain("<remotetype><![CDATA[Fully remote]]></remotetype>");
  });

  it("states the salary period, and omits it entirely when unset", async () => {
    const { body } = await run();
    expect(body).toContain("<salary><![CDATA[MYR 4,000 - 5,500 per month]]></salary>");

    rows = [{ ...JOB, details: { ...JOB.details, salary_min: null, salary_max: null } }];
    const { body: bare } = await run();
    expect(bare).toContain("<salary><![CDATA[]]></salary>");
  });

  it("tags the apply link with the aggregator that sent the visitor", async () => {
    const { body } = await run({ source: "adzuna" });
    expect(body).toContain(`https://hireaster.com/apply/${JOB.id}?source=adzuna`);
  });

  it("refuses a source that would forge a query string", async () => {
    const { body } = await run({ source: "adzuna&utm=x" });
    expect(body).toContain(`?source=adzunautmx`);
  });

  it("maps employment type to the aggregators' vocabulary", async () => {
    const { body } = await run();
    expect(body).toContain("<jobtype><![CDATA[fulltime]]></jobtype>");
  });

  // The dangerous failure: rendering an empty but valid feed tells an
  // aggregator every role was withdrawn, and it delists all of them until the
  // next successful crawl. A 503 makes it retry and keep what it has.
  it("fails loudly rather than publishing an empty feed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    const { statusCode, body } = await run();
    expect(statusCode).toBe(503);
    expect(body).not.toContain("<source>");
  });

  it("serves an empty feed only when there genuinely are no roles", async () => {
    rows = [];
    const { statusCode, body } = await run();
    expect(statusCode).toBe(200);
    expect(body).toContain("<source>");
    expect(body).not.toContain("<job>");
  });
});
