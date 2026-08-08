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

// A real well-formedness walk, not a regex sweep.
//
// The version this replaces stripped CDATA sections before looking at anything,
// which erased the one construct that was actually broken: a CDATA block inside
// an attribute value. The feed shipped malformed and every test passed, because
// the helper deleted the evidence before checking. So this walks the document in
// order and distinguishes where it is: text, CDATA, or inside a tag's
// attributes, where a raw "<" is illegal and ends the parse.
export function xmlErrors(xml) {
  const errs = [];
  const stack = [];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) break;
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt);
      if (end < 0) { errs.push("unterminated CDATA"); break; }
      i = end + 3; continue;
    }
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt);
      if (end < 0) { errs.push("unterminated comment"); break; }
      i = end + 3; continue;
    }
    if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt);
      if (end < 0) { errs.push("unterminated declaration"); break; }
      i = end + 2; continue;
    }
    // A tag. Scan to its ">", tracking quotes so a ">" inside an attribute does
    // not end it early, and rejecting a raw "<" inside a quoted value.
    let quote = null, gt = -1;
    for (let j = lt + 1; j < xml.length; j++) {
      const c = xml[j];
      if (quote) {
        if (c === quote) quote = null;
        else if (c === "<") errs.push(`unescaped '<' in an attribute value near "${xml.slice(lt, lt + 40)}"`);
        continue;
      }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === ">") { gt = j; break; }
    }
    if (gt < 0) { errs.push("unterminated tag"); break; }
    const body = xml.slice(lt + 1, gt);
    const name = (body.match(/^\/?\s*([a-zA-Z][\w.-]*)/) || [])[1];
    if (!name) errs.push(`unnamed tag near "${xml.slice(lt, lt + 30)}"`);
    else if (body.startsWith("/")) {
      if (stack.pop() !== name) errs.push(`closing </${name}> does not match`);
    } else if (!body.endsWith("/")) stack.push(name);
    i = gt + 1;
  }
  if (stack.length) errs.push(`unclosed: ${stack.join(", ")}`);
  return errs;
}

const tagsBalance = (xml) => xmlErrors(xml).length === 0;

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

  // This shipped broken: the id was wrapped in CDATA, which is legal in text
  // content and illegal in an attribute, so Chrome and every XML parser refused
  // the whole document on line 3. An attribute takes entity escaping only.
  it("escapes jooble's job id as an attribute, never as CDATA", async () => {
    const { body } = await run({ dialect: "jooble" });
    expect(body).toContain(`<job id="${JOB.id}">`);
    expect(body).not.toContain('id="<![CDATA[');
    expect(xmlErrors(body)).toEqual([]);
  });

  it("keeps the id an attribute even when it contains quotes or markup", async () => {
    rows = [{ ...JOB, id: `x"><script>&` }];
    const { body } = await run({ dialect: "jooble" });
    expect(body).toContain('<job id="x&quot;&gt;&lt;script&gt;&amp;">');
    expect(xmlErrors(body)).toEqual([]);
  });

  // <region> is what Jooble positions a listing from, so leaving the country out
  // of it means the placement is inferred rather than stated.
  it("names the country inside jooble's region string", async () => {
    rows = [{ ...JOB, address_country: "Malaysia" }];
    const { body } = await run({ dialect: "jooble" });
    expect(body).toContain("<region><![CDATA[Shah Alam, Selangor, Malaysia]]></region>");
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

  // The employer's own address, not ours. A candidate on Adzuna should see the
  // company they are applying to rather than the ATS behind it.
  it("points the apply link at the workspace's own subdomain", async () => {
    const { body } = await run({ source: "adzuna" });
    expect(body).toContain(`https://acme.hireaster.com/apply/${JOB.id}?source=adzuna`);
  });

  it("falls back to the apex when a workspace has no slug", async () => {
    rows = [{ ...JOB, company_slug: null }];
    const { body } = await run();
    expect(body).toContain(`https://hireaster.com/apply/${JOB.id}`);
  });

  // A preview deploy has no wildcard DNS, so a slug subdomain there would not
  // resolve at all.
  it("does not invent a subdomain on a non-apex host", async () => {
    const res = mockRes();
    await handler({ headers: { host: "aster-preview.vercel.app" }, query: {} }, res);
    expect(res.body).toContain(`https://aster-preview.vercel.app/apply/${JOB.id}`);
    expect(res.body).not.toContain("acme.aster-preview");
  });

  it("refuses a source that would forge a query string", async () => {
    const { body } = await run({ source: "adzuna&utm=x" });
    expect(body).toContain(`?source=adzunautmx`);
  });

  // Aggregators filter by ISO country code and treat a full country name as an
  // unknown region, which drops the job out of every country-scoped search.
  it("emits an ISO country code, whichever form the address holds", async () => {
    const { body } = await run();
    expect(body).toContain("<country><![CDATA[MY]]></country>");

    rows = [{ ...JOB, address_country: "Malaysia" }];
    const { body: named } = await run();
    expect(named).toContain("<country><![CDATA[MY]]></country>");

    rows = [{ ...JOB, address_country: "sg" }];
    const { body: lower } = await run();
    expect(lower).toContain("<country><![CDATA[SG]]></country>");
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
