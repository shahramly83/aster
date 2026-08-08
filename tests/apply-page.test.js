// The apply page is the only thing Google reads a JobPosting from, and it is a
// client-rendered app: if the markup is not in the server response it may never
// be seen. These cover the handoff rather than the markup's contents, which
// job-posting.test.js owns.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import handler from "../api/apply.js";

const SHELL = "<html><head><title>Aster</title></head><body></body></html>";

const JOB = {
  id: "11111111-2222-3333-4444-555555555555",
  title: "Warehouse Supervisor",
  status: "open",
  accepting: true,
  created_at: "2026-08-01T02:00:00.000Z",
  expires_at: "2099-12-31",
  company_name: "Acme Logistics",
  logo_url: null,
  address_city: "Petaling Jaya",
  address_state: "Selangor",
  address_country: "Malaysia",
  details: { location: "Shah Alam", employment_type: "full_time", description: "Stock." },
};

let job;
function mockRes() {
  return {
    statusCode: 0, headers: {}, body: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(v) { this.body = v ?? ""; return this; },
  };
}

const run = async () => {
  const res = mockRes();
  await handler({ headers: { host: "hireaster.com" }, query: { id: JOB.id } }, res);
  return res;
};

// Pull the JSON-LD back out the way a crawler would.
const parseLd = (html) => {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1].replace(/<\\\//g, "</")) : null;
};

beforeEach(() => {
  job = { ...JOB };
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubGlobal("fetch", vi.fn(async (u) => {
    if (String(u).includes("/rest/v1/rpc/get_public_job")) {
      return { ok: true, json: async () => [job] };
    }
    return { ok: true, text: async () => SHELL };   // index.html, and the og prewarm
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("apply page", () => {
  it("server-renders the JobPosting markup", async () => {
    const { body } = await run();
    const ld = parseLd(body);
    expect(ld).not.toBeNull();
    expect(ld["@type"]).toBe("JobPosting");
    expect(ld.title).toBe("Warehouse Supervisor");
    expect(ld.url).toBe(`https://hireaster.com/apply/${JOB.id}`);
  });

  it("keeps a closing tag inside the posting from ending the script block", async () => {
    job.details = { ...JOB.details, description: "We use </script> tags a lot" };
    const { body } = await run();
    // The raw document must not contain the sequence that would close early.
    const block = body.slice(body.indexOf('<script type="application/ld+json">'));
    expect(block.slice(0, block.indexOf("</script>"))).not.toContain("</script>");
    expect(parseLd(body).description).toContain("&lt;/script&gt;");
  });

  it("publishes no markup for a closed role, but still previews it", async () => {
    job.status = "closed";
    const { body } = await run();
    expect(parseLd(body)).toBeNull();
    expect(body).toContain("Warehouse Supervisor");   // og tags still rewritten
    expect(body).toMatch(/name="robots" content="noindex"/);
  });

  it("publishes no markup when the role has no resolvable country", async () => {
    job.address_country = null;
    expect(parseLd((await run()).body)).toBeNull();
  });

  it("still serves the page when the job cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u) => {
      if (String(u).includes("get_public_job")) return { ok: false, json: async () => null };
      return { ok: true, text: async () => SHELL };
    }));
    const { statusCode, body } = await run();
    expect(statusCode).toBe(200);
    expect(parseLd(body)).toBeNull();
  });
});
