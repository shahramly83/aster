// Google validates JobPosting strictly and the failure is silent: an invalid
// or stale posting is not shown at all, and repeatedly publishing markup that
// disagrees with the page can cost the whole site its jobs eligibility. So the
// cases worth pinning are the ones where we must publish NOTHING.
import { describe, it, expect } from "vitest";
import { jobPostingLd, descriptionHtml, PAGE_LABELS, BOARD_LABELS } from "../shared/job-posting.js";

const ROW = {
  id: "11111111-2222-3333-4444-555555555555",
  title: "Warehouse Supervisor",
  status: "open",
  accepting: true,
  created_at: "2026-08-01T02:00:00.000Z",
  expires_at: "2099-12-31",
  company_name: "Acme Logistics",
  company_slug: "acme",
  logo_url: "https://cdn.example/logo.png",
  address_city: "Petaling Jaya",
  address_state: "Selangor",
  address_country: "Malaysia",
  details: {
    location: "Shah Alam, Selangor",
    employment_type: "full_time",
    work_mode: "onsite",
    salary_min: 4000, salary_max: 5500, salary_currency: "myr",
    description: "We move stock for a living.",
    responsibilities: ["Run the evening shift"],
    requirements: ["Three years in a warehouse"],
    benefits: ["EPF and SOCSO contributions"],
  },
};
const URL = "https://acme.hireaster.com/apply/11111111-2222-3333-4444-555555555555";
const ld = (patch) => jobPostingLd({ ...ROW, ...patch }, URL);

describe("JobPosting markup", () => {
  it("emits the fields Google requires", () => {
    const p = ld();
    expect(p["@type"]).toBe("JobPosting");
    expect(p.title).toBe("Warehouse Supervisor");
    expect(p.datePosted).toBe("2026-08-01");
    expect(p.validThrough).toBe("2099-12-31T23:59:59+00:00");
    expect(p.hiringOrganization).toMatchObject({ name: "Acme Logistics", logo: ROW.logo_url });
    expect(p.employmentType).toBe("FULL_TIME");
    expect(p.description).toContain("<p>We move stock for a living.</p>");
    expect(p.url).toBe(URL);
  });

  it("resolves the country to a code, since jobLocation is invalid without one", () => {
    expect(ld().jobLocation).toEqual({
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: "Shah Alam",
        addressRegion: "Selangor",
        addressCountry: "MY",
      },
    });
  });

  it("states the salary period rather than leaving it to be guessed", () => {
    expect(ld().baseSalary).toEqual({
      "@type": "MonetaryAmount",
      currency: "MYR",
      value: { "@type": "QuantitativeValue", minValue: 4000, maxValue: 5500, unitText: "MONTH" },
    });
  });

  // Without applicantLocationRequirements a remote role is offered worldwide,
  // including to candidates the employer cannot hire.
  it("bounds a remote role to the country that posted it", () => {
    const p = ld({ details: { ...ROW.details, work_mode: "remote", location: "Remote" } });
    expect(p.jobLocationType).toBe("TELECOMMUTE");
    expect(p.applicantLocationRequirements).toEqual({ "@type": "Country", name: "MY" });
  });

  describe("publishes nothing when the role should not be listed", () => {
    it("closed", () => expect(ld({ status: "closed" })).toBeNull());
    it("past its closing date", () => expect(ld({ expires_at: "2020-01-01" })).toBeNull());
    it("out of screening credits", () => expect(ld({ accepting: false })).toBeNull());
    it("no resolvable country", () => expect(ld({ address_country: null })).toBeNull());
    it("no posting date", () => expect(ld({ created_at: null })).toBeNull());
    it("no apply url", () => expect(jobPostingLd(ROW, "")).toBeNull());
  });

  // The markup is compared against the page a candidate lands on, so it uses
  // the page's own wording. The feed keeps the job-board vocabulary.
  it("describes the role in the page's words, not the job boards'", () => {
    expect(ld().description).toContain("<h3>What you'll do</h3>");
    expect(ld().description).toContain("<h3>What we're looking for</h3>");
    expect(ld().description).not.toContain("<h3>Responsibilities</h3>");
    expect(descriptionHtml(ROW.details, BOARD_LABELS)).toContain("<h3>Responsibilities</h3>");
    expect(descriptionHtml(ROW.details, PAGE_LABELS)).toContain("<h3>What you'll do</h3>");
  });

  it("survives a description containing markup", () => {
    const p = ld({ details: { ...ROW.details, description: "R&D for <b>bold</b> people" } });
    expect(p.description).toContain("R&amp;D for &lt;b&gt;bold&lt;/b&gt; people");
  });
});
