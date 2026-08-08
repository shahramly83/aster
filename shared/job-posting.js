// How a job posting is rendered for machines: the XML feed aggregators crawl
// and the JobPosting markup Google reads.
// ---------------------------------------------------------------------------
// Both describe the same role to a third party, and both are compared against
// the apply page the candidate lands on. Written twice they drift, and the
// consequence is not cosmetic: aggregators downrank or reject a feed whose
// description does not match its landing page, and Google does the same to
// structured data that disagrees with the visible content. So the assembly
// lives here once and both callers pass their own headings.

// Text about to be placed inside HTML we generate. A "&" or "<" typed into a
// job description has to be neutralised before it becomes part of that markup.
export const escapeHtml = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// What the apply page calls these three fields. The feed overrides them with
// the vocabulary job boards expect; anything machine-read that is compared
// against the page itself should use these.
export const PAGE_LABELS = {
  responsibilities: "What you'll do",
  requirements: "What we're looking for",
  benefits: "What we offer",
};

export const BOARD_LABELS = {
  responsibilities: "Responsibilities",
  requirements: "Requirements",
  benefits: "Benefits",
};

// The full posting as HTML: the prose, then the three lists, in the order the
// apply page renders them.
export function descriptionHtml(details, labels = PAGE_LABELS) {
  const d = details || {};
  const out = [];
  const prose = String(d.description || "").trim();
  if (prose) {
    for (const para of prose.split(/\n{2,}/)) {
      const p = para.trim();
      if (p) out.push(`<p>${escapeHtml(p).replace(/\n/g, "<br />")}</p>`);
    }
  }
  const list = (heading, items) => {
    if (!Array.isArray(items) || !items.length) return;
    const rows = items.map((it) => String(it || "").trim()).filter(Boolean);
    if (!rows.length) return;
    out.push(`<h3>${escapeHtml(heading)}</h3><ul>`);
    for (const r of rows) out.push(`<li>${escapeHtml(r)}</li>`);
    out.push("</ul>");
  };
  list(labels.responsibilities, d.responsibilities);
  list(labels.requirements, d.requirements);
  list(labels.benefits, d.benefits);
  return out.join("");
}

// Aggregators and Google both expect an ISO-3166 alpha-2 country code and treat
// a full country name as an unknown region, which drops the job out of every
// country-filtered search. companies.address_country is populated from a select
// of country NAMES, with older rows holding whatever was typed, so it cannot be
// passed through raw.
//
// Only the markets Aster sells into are mapped. Anything unrecognised falls
// through unchanged rather than being guessed at: a wrong country is worse than
// one the reader ignores.
const COUNTRY_CODE = {
  malaysia: "MY", singapore: "SG", indonesia: "ID", thailand: "TH",
  philippines: "PH", vietnam: "VN", "viet nam": "VN", brunei: "BN",
  "hong kong": "HK", india: "IN", australia: "AU", "new zealand": "NZ",
  "united kingdom": "GB", "united states": "US", "united arab emirates": "AE",
};

export function countryCode(raw) {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return COUNTRY_CODE[v.toLowerCase()] || v;
}

// City / state / country as three fields, which is what every consumer of a
// posting wants and what Aster does not store: the job carries one free-text
// location string. The city comes from whatever the recruiter typed (first
// segment, since "Kuala Lumpur, Malaysia" is as common as "Kuala Lumpur") and
// the rest falls back to the company's registered address. That is wrong for a
// company hiring outside its own address, which a structured location field on
// the job would fix.
export function placeOf(row) {
  const raw = String(row?.details?.location || "").trim();
  const first = raw.split(",")[0].trim();
  // "Remote" is a working arrangement, not a city. Left in the city field it
  // puts the role in a town called Remote.
  const cityish = /^(remote|anywhere|work from home|wfh)$/i.test(first) ? "" : first;
  return {
    city: cityish || row?.address_city || "",
    state: row?.address_state || "",
    country: row?.address_country || "",
  };
}

// Monthly, because that is what generate-job-draft produces and what the apply
// page shows. A range published as an annual figure by mistake reaches
// candidates before it reaches us.
export function salaryOf(details) {
  const d = details || {};
  const min = Number(d.salary_min) || 0;
  const max = Number(d.salary_max) || 0;
  if (!min && !max) return null;
  return {
    min: min || max,
    max: max || min,
    currency: String(d.salary_currency || "").toUpperCase(),
  };
}

export const isRemote = (details) =>
  String(details?.work_mode || details?.remote_type || "").toLowerCase() === "remote";

// schema.org's vocabulary, which is not the database's and not the feed's.
const SCHEMA_EMPLOYMENT = {
  full_time: "FULL_TIME", fulltime: "FULL_TIME",
  part_time: "PART_TIME", parttime: "PART_TIME",
  contract: "CONTRACTOR", temporary: "TEMPORARY", internship: "INTERN",
};

// The JobPosting structured data Google reads off the public apply page, which
// is what puts a role in the jobs panel above the ordinary search results.
//
// Returns null when the role should not be there at all, and that is the more
// important half of this function. Google's guidelines require a posting to
// come down the moment it stops accepting applications, and penalise
// structured data that disagrees with the page or omits a required field. A
// role with no resolvable country cannot produce a valid jobLocation, so it is
// better to publish no markup than markup that fails validation.
//
// `row` is a get_public_job result (migration 0174).
export function jobPostingLd(row, applyUrl) {
  if (!row?.title || !applyUrl) return null;
  if (row.status !== "open") return null;
  if (row.accepting === false) return null;

  const today = new Date().toISOString().slice(0, 10);
  if (row.expires_at && String(row.expires_at) < today) return null;

  const d = row.details || {};
  const place = placeOf(row);
  const country = countryCode(place.country);
  if (!country) return null;
  if (!row.created_at) return null;          // datePosted is required

  const remote = isRemote(d);
  const ld = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: row.title,
    description: descriptionHtml(d),
    datePosted: new Date(row.created_at).toISOString().slice(0, 10),
    identifier: {
      "@type": "PropertyValue",
      name: row.company_name || "Aster",
      value: row.id,
    },
    hiringOrganization: {
      "@type": "Organization",
      name: row.company_name || "",
      ...(row.logo_url ? { logo: row.logo_url } : {}),
    },
    // The apply page is a real application form, not a redirect to one, which
    // is the distinction this flag exists to draw.
    directApply: true,
    url: applyUrl,
  };

  // A closing date is what tells Google to stop showing the role. Without one
  // the posting is treated as open indefinitely, and a stale listing is the
  // most common reason a site loses its jobs eligibility.
  if (row.expires_at) ld.validThrough = `${row.expires_at}T23:59:59+00:00`;

  const employment = SCHEMA_EMPLOYMENT[String(d.employment_type || "").toLowerCase()];
  if (employment) ld.employmentType = employment;

  ld.jobLocation = {
    "@type": "Place",
    address: {
      "@type": "PostalAddress",
      ...(place.city ? { addressLocality: place.city } : {}),
      ...(place.state ? { addressRegion: place.state } : {}),
      addressCountry: country,
    },
  };

  // For a fully remote role these two together are what stop Google offering
  // it to candidates in countries the employer cannot actually hire in.
  if (remote) {
    ld.jobLocationType = "TELECOMMUTE";
    ld.applicantLocationRequirements = { "@type": "Country", name: country };
  }

  const salary = salaryOf(d);
  if (salary && salary.currency) {
    ld.baseSalary = {
      "@type": "MonetaryAmount",
      currency: salary.currency,
      value: {
        "@type": "QuantitativeValue",
        minValue: salary.min,
        maxValue: salary.max,
        unitText: "MONTH",
      },
    };
  }

  return ld;
}
