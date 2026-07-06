// Comparison / alternatives content for the marketing site.
// Positioning is written to be fair: every competitor gets an honest "when they
// are the better fit". Competitor capabilities change often, so treat the matrix
// as marketing positioning and verify specifics before publishing.
//
// Matrix values: "yes" (included) | "partial" (limited) | "no" (not included) |
// any other string renders as literal text (e.g. "Minutes", "Enterprise").

// Shared feature rows, in display order.
export const COMPARE_ROWS = [
  { key: "aiScreening", label: "AI resume screening & ranking" },
  { key: "matching", label: "Automatic matching & deduplication" },
  { key: "scheduling", label: "Built-in interview scheduling" },
  { key: "scorecards", label: "Structured interviews & scorecards" },
  { key: "crm", label: "Talent CRM & sourcing" },
  { key: "careers", label: "Careers page & job board" },
  { key: "analytics", label: "Analytics & reporting" },
  { key: "hris", label: "HRIS, onboarding & payroll" },
  { key: "setup", label: "Typical setup time" },
  { key: "bestFor", label: "Best fit" },
];

// Aster's column, shared across every comparison.
export const ASTER_MATRIX = {
  aiScreening: "yes",
  matching: "yes",
  scheduling: "yes",
  scorecards: "yes",
  crm: "yes",
  careers: "yes",
  analytics: "yes",
  hris: "no",
  setup: "Minutes",
  bestFor: "Growing teams",
};

export const COMPARE_COMPETITORS = [
  {
    slug: "greenhouse",
    name: "Greenhouse",
    category: "Enterprise ATS",
    tint: "#D98BF5",
    subtitle: "The configurable enterprise ATS, compared with Aster's AI-native approach.",
    intro: "Greenhouse is one of the most established applicant tracking systems, built for large organisations that want to design a highly structured, heavily configured hiring process. It is powerful and deep. Aster takes a different starting point: it reads, scores and ranks every applicant for you, and gets a growing team hiring in an afternoon rather than a quarter.",
    edge: [
      "AI screening and ranking on every applicant, not a paid add-on",
      "Interview scheduling and candidate self-booking built in",
      "Set up and hiring the same day, with no implementation project",
    ],
    whenThem: "If you are a large enterprise with a dedicated recruiting-operations team and complex, multi-stage approval workflows across many departments, Greenhouse's configurability and integration marketplace are genuinely hard to beat.",
    migration: "Moving to Aster is straightforward: export your candidates and jobs, import them, and Aster parses and re-ranks everyone against your open roles. Most teams are running live in a day.",
    matrix: { aiScreening: "partial", matching: "partial", scheduling: "yes", scorecards: "yes", crm: "partial", careers: "yes", analytics: "yes", hris: "no", setup: "Weeks", bestFor: "Enterprise" },
  },
  {
    slug: "lever",
    name: "Lever",
    category: "ATS + CRM",
    tint: "#A98CFF",
    subtitle: "Lever pairs an ATS with a sourcing CRM. Here is how it lines up against Aster.",
    intro: "Lever built its name on combining an applicant tracking system with a candidate relationship manager, so sourcing and tracking live in one place. It suits teams that do a lot of proactive outreach. Aster covers sourcing and a talent CRM too, but leads with AI that does the first pass on every inbound applicant so your shortlist is ready before you start reaching out.",
    edge: [
      "Every applicant is screened and ranked automatically, with the reasons shown",
      "One clean record per person, deduplicated across old and new applications",
      "Scheduling and scorecards included, so the whole loop lives in one tool",
    ],
    whenThem: "If your hiring is sourcing-led and your team spends most of its time on outbound nurture campaigns to passive candidates, Lever's CRM heritage and campaign tooling are a natural fit.",
    migration: "Bring your candidate database across and Aster deduplicates it into one record per person, then ranks your pool against every open role so nobody strong gets lost in the move.",
    matrix: { aiScreening: "partial", matching: "partial", scheduling: "yes", scorecards: "yes", crm: "yes", careers: "yes", analytics: "yes", hris: "no", setup: "Weeks", bestFor: "Mid-market" },
  },
  {
    slug: "ashby",
    name: "Ashby",
    category: "All-in-one, analytics-led",
    tint: "#7FA0FF",
    subtitle: "Ashby is known for deep analytics. See where Aster fits alongside it.",
    intro: "Ashby brings sourcing, tracking, scheduling and reporting into one all-in-one platform, and is especially loved for its depth of analytics. It rewards teams who want to slice their funnel every possible way. Aster shares the all-in-one philosophy but points its intelligence at the top of the funnel: reading and ranking every applicant so the shortlist, not the dashboard, is where you start.",
    edge: [
      "AI reads and scores each resume the moment it lands, so screening is not manual",
      "Ranked shortlists with reasons, not just charts about your pipeline",
      "Fast to adopt, with no analytics setup required to get value on day one",
    ],
    whenThem: "If your talent team is data-obsessed and wants to build custom reports and dashboards on every dimension of hiring, Ashby's analytics depth is a real strength worth having.",
    migration: "Export from Ashby, import to Aster, and your candidates are parsed and re-ranked against open roles. Your reporting stays clean because Aster keeps one record per person.",
    matrix: { aiScreening: "partial", matching: "partial", scheduling: "yes", scorecards: "yes", crm: "yes", careers: "yes", analytics: "yes", hris: "no", setup: "Days", bestFor: "Scaleups" },
  },
  {
    slug: "workable",
    name: "Workable",
    category: "SMB-friendly ATS",
    tint: "#D98BF5",
    subtitle: "Workable is quick to start and job-board friendly. Compared with Aster.",
    intro: "Workable is a popular choice for small and mid-sized companies, known for fast setup, wide job-board reach and a growing set of AI features. It is a solid generalist. Aster overlaps on quick setup and AI, but its AI is the core of the product rather than an assistant bolted on, so every applicant is screened, scored and ranked by default.",
    edge: [
      "AI screening and ranking is the heart of the product, applied to every applicant",
      "Automatic deduplication keeps one clean record per candidate",
      "Scheduling, scorecards and a talent CRM included without stacking add-ons",
    ],
    whenThem: "If your priority is casting the widest possible net across many job boards and you want a broad, familiar generalist ATS, Workable's distribution and marketplace are a strong reason to choose it.",
    migration: "Export your Workable candidates and jobs, import them into Aster, and Aster re-parses and ranks everyone so your shortlist is ready the day you switch.",
    matrix: { aiScreening: "partial", matching: "partial", scheduling: "yes", scorecards: "yes", crm: "yes", careers: "yes", analytics: "partial", hris: "no", setup: "Hours", bestFor: "SMBs" },
  },
  {
    slug: "bamboohr",
    name: "BambooHR",
    category: "HR suite with hiring",
    tint: "#A98CFF",
    subtitle: "BambooHR is an HR platform first. Here is how its hiring compares with Aster.",
    intro: "BambooHR is an HR information system with hiring, onboarding and people management in one suite, aimed at small companies that want everything in a single place. Its strength is HR breadth. Aster is not an HRIS: it is a dedicated hiring platform that goes far deeper on the recruiting side, screening and ranking applicants with AI and running structured interviews and scheduling that a general HR suite does not.",
    edge: [
      "AI screening, ranking and matching that a general HR suite does not offer",
      "Structured interviews, scorecards and self-serve scheduling built for hiring",
      "A talent CRM that turns past applicants into your next hire",
    ],
    whenThem: "If you are a small company whose main need is a single system for HR records, time off, onboarding and payroll, and hiring is a light, occasional task, BambooHR's all-in-one HR suite makes a lot of sense.",
    migration: "Many teams keep BambooHR for core HR and add Aster for hiring, connecting the two so a hired candidate flows into onboarding. You get real recruiting depth without giving up your HR system.",
    matrix: { aiScreening: "no", matching: "no", scheduling: "partial", scorecards: "partial", crm: "no", careers: "yes", analytics: "partial", hris: "yes", setup: "Days", bestFor: "Small-biz HR" },
  },
];

// The /compare hub intro.
export const COMPARE_HUB = {
  eyebrow: "Compare Aster",
  title: "See how Aster",
  accent: "stacks up.",
  subtitle: "Honest, side-by-side comparisons with the tools teams weigh Aster against. Every one includes where the other tool is the better fit, because a fair comparison is the only kind worth reading.",
};

// The /compare/alternatives page.
export const COMPARE_ALTERNATIVES = {
  eyebrow: "Alternatives & migration",
  title: "Looking to switch",
  accent: "your ATS?",
  subtitle: "Whatever you are using today, moving to Aster is designed to be quick and lossless. Here is why teams switch, and how the move actually works.",
  reasons: [
    { icon: "matching", title: "AI does the first pass", body: "Instead of reading every application by hand, you start from a ranked shortlist with the reasons attached. It is the biggest day-one difference teams feel." },
    { icon: "calendar", title: "The whole loop in one tool", body: "Screening, scheduling, structured interviews, scorecards and offers live together, so you stop stitching three tools and a spreadsheet into a process." },
    { icon: "hire", title: "Live in a day, not a quarter", body: "There is no implementation project. Import your candidates and jobs, and Aster parses and ranks everyone against your open roles the same day." },
    { icon: "search", title: "Your pool comes with you", body: "Aster deduplicates your imported database into one record per person and ranks it against open roles, so no strong past candidate is lost in the move." },
  ],
  steps: [
    { n: "1", title: "Export from your current tool", body: "Pull your candidates and open jobs out of your existing ATS or HR suite. Every major tool supports an export." },
    { n: "2", title: "Import into Aster", body: "Upload the file. Aster parses each resume into structured data and deduplicates people into one clean record." },
    { n: "3", title: "Let Aster rank your pool", body: "Aster scores every candidate against your open roles, so you reopen your searches from a ready-made shortlist." },
    { n: "4", title: "Invite your team", body: "Add recruiters, hiring managers and interviewers, and pick up hiring where you left off, in one place." },
  ],
};
