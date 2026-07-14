// Generate a demo-data seed for a FRESH test workspace:
//   10 fully-written job postings, 50 candidates, 50 applications across every stage.
//
// Writes supabase/seed/demo-data.sql, which you paste into the Supabase SQL editor
// after changing ONE line (the workspace slug) at the top.
//
//   node scripts/gen-seed-demo.mjs
//
// Seeding via SQL (not the apply page) is deliberate: 50 real applications would
// spend 50 resume-parse credits, make 50 Claude calls, and email the hiring
// managers 50 times. This costs nothing and lets us pin every stage exactly.
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "supabase", "seed", "demo-data.sql");

const q = (s) => (s === null || s === undefined ? "null" : `'${String(s).replace(/'/g, "''")}'`);
const jb = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;

// ---------------------------------------------------------------------------
// 10 jobs. 4 open (inside a Scale plan's 5-role cap), 3 draft, 3 closed.
// ---------------------------------------------------------------------------
const JOBS = [
  {
    title: "Senior Financial Analyst", status: "open", department: "Finance", location: "Kuala Lumpur",
    employment_type: "full_time", remote_type: "onsite", seniority_level: "senior",
    salary_min: 8000, salary_max: 12000, openings: 1,
    description: "Own the numbers behind how we grow. You'll run budgeting and forecasting, turn messy data into decisions the leadership team can act on, and partner with department heads on the plans they commit to.",
    responsibilities: ["Own the monthly close and the management reporting pack", "Build and maintain the rolling forecast", "Partner with department heads on budgets and variance", "Model scenarios for pricing and headcount decisions"],
    requirements: ["5+ years in FP&A, corporate finance or audit", "Advanced Excel, including modelling from scratch", "SQL and a BI tool (Power BI or Tableau)", "A finance or accounting degree"],
    benefits: ["Hybrid-friendly after probation", "Annual performance bonus", "Medical for you and dependants"],
    skills: ["Financial Modeling", "Forecasting & Budgeting", "Advanced Excel", "SQL", "Power BI", "Variance Analysis"],
  },
  {
    title: "Digital Marketing Specialist", status: "open", department: "Marketing", location: "Kuala Lumpur",
    employment_type: "full_time", remote_type: "hybrid", seniority_level: "mid",
    salary_min: 4500, salary_max: 7000, openings: 1,
    description: "Own the channels that bring our brand to life online. You'll run campaigns end to end, from strategy to content to reporting, and you'll be judged on pipeline, not impressions.",
    responsibilities: ["Plan and run paid campaigns across Meta and Google", "Own the content calendar and the brand voice", "Report on CAC, ROAS and pipeline contribution", "Run SEO and lifecycle email"],
    requirements: ["3+ years running digital campaigns", "Hands-on with Google Ads and Meta Ads Manager", "Comfortable in GA4 and a CRM", "Strong written English"],
    benefits: ["Hybrid working", "Learning budget", "Medical coverage"],
    skills: ["Google Ads", "Meta Ads", "SEO", "GA4", "Content Marketing", "Email Marketing"],
  },
  {
    title: "Mechanical Engineer", status: "open", department: "Production", location: "Penang",
    employment_type: "full_time", remote_type: "onsite", seniority_level: "mid",
    salary_min: 5000, salary_max: 8000, openings: 2,
    description: "Design, improve, and optimise the products and processes that keep our production line running. You'll work across the full cycle, from concept and CAD through prototyping to the floor.",
    responsibilities: ["Design components and fixtures in CAD", "Run DFM reviews with the production team", "Troubleshoot line issues and drive root-cause fixes", "Own documentation and engineering change orders"],
    requirements: ["3+ years in mechanical or manufacturing engineering", "SolidWorks or AutoCAD to a professional standard", "Familiar with GD&T and tolerance stack-up", "Degree in Mechanical Engineering"],
    benefits: ["Shift allowance", "Annual bonus", "Medical and dental"],
    skills: ["SolidWorks", "AutoCAD", "GD&T", "DFM", "Root Cause Analysis", "Lean Manufacturing"],
  },
  {
    title: "Registered Nurse (ICU)", status: "open", department: "Nursing", location: "Kuala Lumpur",
    employment_type: "full_time", remote_type: "onsite", seniority_level: "mid",
    salary_min: 4000, salary_max: 6000, openings: 3,
    description: "Join our Intensive Care Unit caring for critically ill patients in a fast-paced, high-acuity environment. You'll work alongside intensivists and a close-knit nursing team.",
    responsibilities: ["Deliver direct care to critically ill patients", "Monitor and interpret haemodynamic data", "Administer medication and manage ventilated patients", "Support families through difficult decisions"],
    requirements: ["Valid nursing registration with the Malaysian Nursing Board", "2+ years in ICU, HDU or emergency", "BLS and ACLS certified", "Comfortable on a rotating shift roster"],
    benefits: ["Shift and on-call allowance", "Continuing education support", "Medical for family"],
    skills: ["Critical Care", "Ventilator Management", "ACLS", "Patient Assessment", "IV Therapy"],
  },
  {
    title: "Full Stack Engineer", status: "draft", department: "Engineering", location: "Kuala Lumpur",
    employment_type: "full_time", remote_type: "remote", seniority_level: "senior",
    salary_min: 9000, salary_max: 14000, openings: 2,
    description: "Build the product end to end. You'll ship features from the database to the browser, own what you build in production, and help set the engineering bar as we grow.",
    responsibilities: ["Ship features across React and Node", "Design schemas and write the queries behind them", "Own your services in production, including on-call", "Review code and mentor mid-level engineers"],
    requirements: ["5+ years building web products", "Strong React and TypeScript", "Comfortable with PostgreSQL and SQL", "Experience with cloud infrastructure"],
    benefits: ["Fully remote", "Home office budget", "Stock options"],
    skills: ["React", "TypeScript", "Node.js", "PostgreSQL", "AWS", "System Design"],
  },
  {
    title: "HR Business Partner", status: "draft", department: "People", location: "Kuala Lumpur",
    employment_type: "full_time", remote_type: "hybrid", seniority_level: "senior",
    salary_min: 7000, salary_max: 10000, openings: 1,
    description: "Sit alongside the business as the person leaders come to on anything people-related, from org design and performance to the difficult conversations.",
    responsibilities: ["Partner with department heads on org and workforce planning", "Coach managers through performance and conduct", "Own employee relations cases end to end", "Drive engagement and retention initiatives"],
    requirements: ["5+ years as an HRBP or HR generalist", "Strong grasp of Malaysian employment law", "Track record handling ER cases", "Degree in HR, Psychology or similar"],
    benefits: ["Hybrid working", "Professional membership paid", "Medical coverage"],
    skills: ["Employee Relations", "Org Design", "Performance Management", "Employment Law", "Coaching"],
  },
  {
    title: "Supply Chain Analyst", status: "draft", department: "Operations", location: "Penang",
    employment_type: "full_time", remote_type: "onsite", seniority_level: "mid",
    salary_min: 4500, salary_max: 7000, openings: 1,
    description: "Keep goods moving and costs honest. You'll forecast demand, watch inventory, and find the money hiding in our logistics.",
    responsibilities: ["Forecast demand and set inventory targets", "Track supplier performance and lead times", "Model landed cost and freight scenarios", "Report on OTIF and stock health"],
    requirements: ["3+ years in supply chain, planning or logistics", "Strong Excel and a working knowledge of SQL", "Experience with an ERP such as SAP", "Degree in Supply Chain, Business or Engineering"],
    benefits: ["Annual bonus", "Medical", "Transport allowance"],
    skills: ["Demand Planning", "Inventory Management", "SAP", "Advanced Excel", "SQL", "Logistics"],
  },
  {
    title: "Customer Success Manager", status: "closed", department: "Customer", location: "Kuala Lumpur",
    employment_type: "full_time", remote_type: "hybrid", seniority_level: "mid",
    salary_min: 5000, salary_max: 8000, openings: 1,
    description: "Own the relationship after the sale. You'll onboard new accounts, drive adoption, and turn renewals into expansion.",
    responsibilities: ["Onboard and activate new accounts", "Run quarterly business reviews", "Own renewal and expansion targets", "Be the voice of the customer internally"],
    requirements: ["3+ years in customer success or account management", "Comfortable with a SaaS product and its metrics", "Strong presentation skills", "Experience with a CRM"],
    benefits: ["Commission on expansion", "Hybrid working", "Medical"],
    skills: ["Account Management", "Onboarding", "Renewals", "CRM", "Stakeholder Management"],
  },
  {
    title: "Data Engineer", status: "closed", department: "Engineering", location: "Kuala Lumpur",
    employment_type: "full_time", remote_type: "remote", seniority_level: "senior",
    salary_min: 9000, salary_max: 13000, openings: 1,
    description: "Build the pipelines the whole company reports on. You'll own ingestion, modelling and the warehouse, and make data something people trust.",
    responsibilities: ["Build and own batch and streaming pipelines", "Model the warehouse for analytics", "Own data quality and lineage", "Support analysts and the BI layer"],
    requirements: ["4+ years in data engineering", "Strong Python and SQL", "Airflow or an equivalent orchestrator", "Warehouse experience: BigQuery, Snowflake or Redshift"],
    benefits: ["Fully remote", "Conference budget", "Stock options"],
    skills: ["Python", "SQL", "Airflow", "dbt", "BigQuery", "Data Modeling"],
  },
  {
    title: "Sales Executive", status: "closed", department: "Sales", location: "Johor Bahru",
    employment_type: "full_time", remote_type: "onsite", seniority_level: "junior",
    salary_min: 3000, salary_max: 5000, openings: 2,
    description: "Open doors and close deals. You'll own a patch, build your own pipeline, and be measured on what you bring in.",
    responsibilities: ["Prospect and qualify new business", "Run demos and negotiate to close", "Keep the CRM honest", "Hit a monthly quota"],
    requirements: ["1+ year in a quota-carrying sales role", "Comfortable cold-calling and prospecting", "Clear spoken English and Bahasa Malaysia", "Own transport"],
    benefits: ["Uncapped commission", "Petrol and phone allowance", "Medical"],
    skills: ["Prospecting", "Negotiation", "CRM", "Cold Calling", "Presentation"],
  },
];

// ---------------------------------------------------------------------------
// 50 candidates. Unique emails (Aster de-dupes candidates by email).
// ---------------------------------------------------------------------------
const FIRST = ["Priya", "Aisha", "Ganesan", "Shamsul", "Hanif", "Mei", "Wei Sheng", "Nurul", "Rajesh", "Farah", "Daniel", "Siti", "Arjun", "Chee Keong", "Zarina", "Kumar", "Amirah", "Jason", "Suhaila", "Ravi", "Lim", "Noraini", "Vikram", "Adlina", "Tan", "Hafiz", "Divya", "Yusof", "Melissa", "Iskandar", "Anitha", "Faizal", "Grace", "Rosli", "Kavitha", "Zulkifli", "Michelle", "Azman", "Preeti", "Ling", "Syafiq", "Deepa", "Rashid", "Joanne", "Ashraf", "Sarita", "Khairul", "Cindy", "Bala", "Norhayati"];
const LAST = ["Nair", "Rahman", "Pillar", "Yusoff", "Hassan", "Kwan", "Lim", "Aziz", "Menon", "Ibrahim", "Teoh", "Roslan", "Subramaniam", "Ong", "Kamal", "Raj", "Salleh", "Chong", "Bakar", "Kumar", "Wei", "Osman", "Singh", "Zainal", "Boon", "Karim", "Sharma", "Ahmad", "Fernandez", "Shah", "Devi", "Nordin", "Tay", "Idris", "Ramesh", "Latif", "Goh", "Hamid", "Kapoor", "Chin", "Anwar", "Pillai", "Malek", "Wong", "Rashid", "Verma", "Zaki", "Low", "Krishnan", "Yaakob"];

// Per-role candidate archetypes, so a candidate actually looks like the job.
const ARCH = {
  "Senior Financial Analyst": {
    titles: ["FP&A Lead", "Senior Financial Analyst", "Finance Business Partner", "Financial Analyst"],
    skills: ["Financial Modeling", "Forecasting & Budgeting", "Advanced Excel", "SQL", "Power BI", "Variance Analysis", "Hyperion"],
    industries: ["Banking", "Retail", "Oil & Gas"], degree: "Bachelor of Accounting & Finance",
    certs: ["CFA Level II"], schools: ["Universiti Malaya", "Universiti Teknologi MARA"],
    companies: ["Bright Retail Sdn Bhd", "Delta Trading Berhad", "Maybank", "Petronas"],
  },
  "Digital Marketing Specialist": {
    titles: ["Digital Marketing Executive", "Performance Marketing Specialist", "Growth Marketer", "Content Lead"],
    skills: ["Google Ads", "Meta Ads", "SEO", "GA4", "Content Marketing", "Email Marketing", "HubSpot"],
    industries: ["E-commerce", "SaaS", "Agency"], degree: "Bachelor of Mass Communication",
    certs: ["Google Ads Certified"], schools: ["Taylor's University", "Sunway University"],
    companies: ["Lazada", "Grab", "Adzuna Digital", "Shopee"],
  },
  "Mechanical Engineer": {
    titles: ["Mechanical Engineer", "Design Engineer", "Manufacturing Engineer", "Process Engineer"],
    skills: ["SolidWorks", "AutoCAD", "GD&T", "DFM", "Root Cause Analysis", "Lean Manufacturing"],
    industries: ["Manufacturing", "Semiconductor", "Automotive"], degree: "Bachelor of Mechanical Engineering",
    certs: ["Six Sigma Green Belt"], schools: ["Universiti Sains Malaysia", "Universiti Teknologi Malaysia"],
    companies: ["Intel Penang", "Osram", "Proton", "Western Digital"],
  },
  "Registered Nurse (ICU)": {
    titles: ["Staff Nurse (ICU)", "Registered Nurse", "Critical Care Nurse", "Senior Staff Nurse"],
    skills: ["Critical Care", "Ventilator Management", "ACLS", "Patient Assessment", "IV Therapy"],
    industries: ["Healthcare"], degree: "Diploma in Nursing",
    certs: ["BLS", "ACLS"], schools: ["Universiti Kebangsaan Malaysia", "Institut Latihan KKM"],
    companies: ["Gleneagles KL", "Pantai Hospital", "Hospital Kuala Lumpur", "Sunway Medical"],
  },
  "Full Stack Engineer": {
    titles: ["Full Stack Engineer", "Senior Software Engineer", "Backend Engineer", "Frontend Engineer"],
    skills: ["React", "TypeScript", "Node.js", "PostgreSQL", "AWS", "System Design", "Docker"],
    industries: ["SaaS", "Fintech", "E-commerce"], degree: "Bachelor of Computer Science",
    certs: ["AWS Solutions Architect"], schools: ["Universiti Malaya", "Multimedia University"],
    companies: ["Setel", "BigPay", "Carsome", "iPrice Group"],
  },
};
// Candidates applying to a job we have no archetype for reuse the closest one.
const archFor = (title) => ARCH[title] || ARCH["Full Stack Engineer"];

// Every stage is represented. 50 applications in total.
const STAGE_PLAN = [
  ["applied", 16],
  ["shortlisted", 9],
  ["interviewing", 7],
  ["offer", 5],
  ["hired", 5],
  ["rejected", 5],
  ["declined", 3],
];
const SOURCES = ["Career Page", "LinkedIn", "WhatsApp", "JobStreet", "Referral", "Talent database", "Facebook"];

// Deterministic pseudo-random so re-generating gives the same seed file.
let s = 42;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

// Only jobs that can actually take applicants (open + closed roles have history;
// drafts have none, which is realistic and lets us prove the empty state).
const APPLICABLE = JOBS.filter((j) => j.status !== "draft").map((j) => j.title);

const candidates = [];
const applications = [];

let n = 0;
for (const [stage, count] of STAGE_PLAN) {
  for (let i = 0; i < count; i++) {
    const first = FIRST[n % FIRST.length];
    const last = LAST[(n * 7 + 3) % LAST.length];
    const name = `${first} ${last}`;
    // Unique email per candidate — this is what stops Aster merging them.
    const email = `${first.toLowerCase().replace(/\s+/g, "")}.${last.toLowerCase()}${n}@example.com`;
    const jobTitle = APPLICABLE[n % APPLICABLE.length];
    const a = archFor(jobTitle);

    const years = int(1, 12);
    const seniority = years >= 8 ? "Senior" : years >= 4 ? "Mid-level" : "Junior";
    const title = pick(a.titles);
    const company = pick(a.companies);
    const skills = a.skills.slice(0, int(4, Math.min(6, a.skills.length)));

    // ~1 in 6 is judged a poor fit for the role, and carries the AI's reason.
    const isOther = n % 6 === 5;
    const why = isOther
      ? `Background is in ${pick(["hospitality", "teaching", "logistics", "retail floor"])} rather than ${jobTitle.toLowerCase()}, and the listed requirements around ${skills[0]} and ${skills[1]} are not evidenced.`
      : null;
    // Ranked candidates carry a score; unranked ones don't (so both states exist).
    const scored = !isOther && n % 3 !== 0;
    const score = scored ? int(58, 95) : null;

    candidates.push({
      name, email,
      phone: `+60 1${int(1, 9)}-${int(200, 999)} ${int(1000, 9999)}`,
      location: pick(["Kuala Lumpur, Malaysia", "Penang, Malaysia", "Selangor, Malaysia", "Johor Bahru, Malaysia"]),
      summary: `${seniority} ${jobTitle.toLowerCase()} with ${years} years across ${a.industries.join(" and ")}. ${pick(["Known for turning messy problems into working systems.", "Comfortable owning outcomes end to end.", "Strong communicator across technical and business teams."])}`,
      years, seniority, skills,
      certs: a.certs, industries: a.industries,
      title, company,
      duration: `${int(2018, 2022)} - Present`,
      exp_summary: `Owned ${pick(["delivery", "reporting", "operations", "the roadmap"])} for ${company}, working across ${skills.slice(0, 2).join(" and ")}.`,
      degree: a.degree, school: pick(a.schools), grad_year: 2024 - years - int(0, 2),
      days: int(0, 30),
    });

    applications.push({
      email, jobTitle, stage,
      source: pick(SOURCES),
      fit: isOther ? "other" : "strong",
      why, score,
      days: int(0, 30),
    });
    n++;
  }
}

// ---------------------------------------------------------------------------
// Emit SQL
// ---------------------------------------------------------------------------
const jobRows = JOBS.map((j) => {
  const details = {
    department: j.department, location: j.location,
    employment_type: j.employment_type, remote_type: j.remote_type,
    seniority_level: j.seniority_level, seniority_levels: [j.seniority_level],
    salary_min: j.salary_min, salary_max: j.salary_max, currency: "MYR",
    openings: j.openings,
    description: j.description,
    responsibilities: j.responsibilities,
    requirements: j.requirements,
    benefits: j.benefits,
    skills: j.skills,
  };
  return `  (${q(j.title)}, ${q(j.status)}, ${jb(details)})`;
}).join(",\n");

const candRows = candidates.map((c) => `  (${q(c.name)}, ${q(c.email)}, ${q(c.phone)}, ${q(c.location)}, ${q(c.summary)}, ${c.years}, ${jb(c.skills)}, ${q(c.seniority)}, ${jb(c.certs)}, ${jb(c.industries)}, ${q(c.title)}, ${q(c.company)}, ${q(c.duration)}, ${q(c.exp_summary)}, ${q(c.degree)}, ${q(c.school)}, ${c.grad_year}, ${c.days})`).join(",\n");

const appRows = applications.map((a) => `  (${q(a.email)}, ${q(a.jobTitle)}, ${q(a.stage)}, ${q(a.source)}, ${q(a.fit)}, ${a.why ? q(a.why) : "null"}, ${a.score === null ? "null" : a.score}, ${a.days})`).join(",\n");

const sql = `-- ============================================================================
-- Aster demo data: 10 job postings, ${candidates.length} candidates, ${applications.length} applications
-- ============================================================================
-- GENERATED by scripts/gen-seed-demo.mjs — do not hand-edit; re-run the script.
--
-- HOW TO USE
--   1. Change the slug on the next line to your test workspace's slug
--      (it's the subdomain: <slug>.hireaster.com).
--   2. Paste this whole file into the Supabase SQL editor and run it.
--
-- Seeding here rather than through the apply page is deliberate: ${applications.length} real
-- applications would spend ${applications.length} resume-parse credits, make ${applications.length} Claude calls and
-- email your hiring managers ${applications.length} times. This costs nothing.
--
-- Every candidate has a UNIQUE email, because Aster de-duplicates candidates by
-- email — reusing one address makes each new resume overwrite the last person.
--
-- Jobs: 4 open, 3 draft, 3 closed. Applications cover every stage:
--   applied, shortlisted, interviewing, offer, hired, rejected, declined.
-- ============================================================================

\\set ON_ERROR_STOP on

do $seed$
declare
  v_slug     text := 'REPLACE_WITH_YOUR_SLUG';   -- <<<< CHANGE THIS
  v_company  uuid;
  v_owner    uuid;
begin
  select id into v_company from public.companies where slug = v_slug;
  if v_company is null then
    raise exception 'No workspace with slug %. Set v_slug to your test workspace.', v_slug;
  end if;
  select id into v_owner from public.profiles
    where company_id = v_company and role = 'owner' limit 1;

  -- The open-role trigger enforces the plan's concurrent cap. Seeding is not a
  -- product action, so step around it and restore it straight after.
  alter table public.jobs disable trigger trg_charge_job_post;

  ----------------------------------------------------------------------------
  -- 1) Jobs
  ----------------------------------------------------------------------------
  insert into public.jobs (company_id, created_by, title, status, details)
  select v_company, v_owner, j.title, j.status, j.details
  from (values
${jobRows}
  ) as j(title, status, details);

  ----------------------------------------------------------------------------
  -- 2) Candidates (unique emails; parsed jsonb is what the UI actually renders)
  ----------------------------------------------------------------------------
  insert into public.candidates
    (company_id, full_name, email, phone, location, summary, years_experience,
     skills, file_name, status, has_photo, parsed, created_at)
  select
    v_company, c.name, c.email, c.phone, c.location, c.summary, c.years,
    c.skills,
    lower(replace(c.name, ' ', '_')) || '_resume.pdf',
    'parsed', false,
    jsonb_build_object(
      'name', c.name,
      'email', c.email,
      'phone', c.phone,
      'location', c.location,
      'summary', c.summary,
      'years_of_experience', c.years,
      'seniority', c.seniority,
      'skills', c.skills,
      'certifications', c.certs,
      'industries', c.industries,
      'languages', jsonb_build_array('English', 'Bahasa Malaysia'),
      'experience', jsonb_build_array(jsonb_build_object(
        'title', c.title, 'company', c.company,
        'duration', c.duration, 'summary', c.exp_summary
      )),
      'education', jsonb_build_array(jsonb_build_object(
        'degree', c.degree, 'institution', c.school, 'year', c.grad_year
      ))
    ),
    now() - (c.days * interval '1 day')
  from (values
${candRows}
  ) as c(name, email, phone, location, summary, years, skills, seniority, certs,
         industries, title, company, duration, exp_summary, degree, school,
         grad_year, days);

  ----------------------------------------------------------------------------
  -- 3) Applications — every stage represented
  ----------------------------------------------------------------------------
  insert into public.applications
    (company_id, candidate_id, job_id, stage, source, fit, match_reasons,
     match_score, created_at)
  select
    v_company, cand.id, j.id,
    a.stage::public.app_stage,
    a.source,
    a.fit,
    case when a.why is null then null else to_jsonb(a.why) end,
    a.score,
    now() - (a.days * interval '1 day')
  from (values
${appRows}
  ) as a(email, job_title, stage, source, fit, why, score, days)
  join public.candidates cand
    on cand.company_id = v_company and cand.email = a.email
  join public.jobs j
    on j.company_id = v_company and j.title = a.job_title;

  alter table public.jobs enable trigger trg_charge_job_post;

  -- Assign every non-owner teammate to the OPEN roles. Without a job_assignments
  -- row an interviewer sees nothing at all: that table, not the interview panel, is
  -- what RLS reads to decide which jobs and candidates they may look at. Seeding
  -- jobs without it leaves the interviewer journey untestable.
  insert into public.job_assignments (job_id, profile_id, company_id, assigned_by)
  select j.id, p.id, v_company, v_owner
    from public.jobs j
    cross join public.profiles p
   where j.company_id = v_company
     and j.status = 'open'
     and p.company_id = v_company
     and p.status = 'active'
     and p.role in ('admin', 'interviewer')
  on conflict (job_id, profile_id) do nothing;

  raise notice 'Seeded % jobs, % candidates, % applications, % assignments into workspace %',
    (select count(*) from public.jobs where company_id = v_company),
    (select count(*) from public.candidates where company_id = v_company),
    (select count(*) from public.applications where company_id = v_company),
    (select count(*) from public.job_assignments where company_id = v_company),
    v_slug;
end
$seed$;
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, sql, "utf8");
console.log(`Wrote ${OUT}`);
console.log(`  ${JOBS.length} jobs (${JOBS.filter((j) => j.status === "open").length} open, ${JOBS.filter((j) => j.status === "draft").length} draft, ${JOBS.filter((j) => j.status === "closed").length} closed)`);
console.log(`  ${candidates.length} candidates (all unique emails)`);
console.log(`  ${applications.length} applications across ${STAGE_PLAN.length} stages`);
for (const [stage, count] of STAGE_PLAN) console.log(`    ${stage.padEnd(13)} ${count}`);
