# Aster — Go-to-Market & User Acquisition Plan

_Last updated: 2026-08-13 · Owner: Growth · Domain: hireaster.com_

> Aster is an all-in-one AI recruitment platform (ATS + AI screening + interviews + offers + analytics) for **growing teams**. This plan lays out how to bring in users: who we target, the message, the channels, the funnel, and a concrete 90-day execution schedule with metrics.

---

## 1. Positioning (the one sentence everything hangs off)

**Aster turns a two-week shortlist into an afternoon.** It replaces the 4–5 disconnected tools a growing team stitches together (job board + inbox + spreadsheet + calendar + scorecard doc) with one platform where resumes land parsed and scored, the whole team works one pipeline, interviews book themselves, and analytics show where candidates drop off.

**Category:** AI recruitment software / all-in-one ATS.

**Who it is _not_ for (say this out loud):** enterprises that need heavy custom workflows and a 6-week implementation. Naming who we're not for makes the "for growing teams" claim credible.

**Wedge vs. incumbents** — from the existing comparison matrix (Greenhouse, Lever, Workable, Ashby, BambooHR):

| Competitor | Their position | Aster's counter |
|---|---|---|
| Greenhouse / Lever / Ashby | Enterprise ATS, "Weeks" to set up | **Minutes to set up**, priced and scoped for teams without a recruiting ops function |
| BambooHR | HRIS with light hiring | Purpose-built hiring depth (AI scoring, scorecards, source analytics) |
| Workable | Mid-market ATS | AI screening + explainable match scores + regional fit (JobStreet, WhatsApp) built in, not bolted on |

**Three proof points to lead with everywhere:** (1) AI match score _with the reasons behind it_ (defensible, not a black box), (2) one shared pipeline / minutes to set up, (3) built for how the region actually hires — JobStreet posting, WhatsApp Business reminders, branded career site.

---

## 2. Ideal Customer Profile & segments

Anchored to the three use-cases already in our marketing content — these are the beachhead ICPs.

| Segment | Who / trigger | Pain we remove | Entry plan |
|---|---|---|---|
| **A. Seed / early-stage startups** | Founder or founding engineer doing half the interviewing; hiring 3–5 roles at once | 90 unread resumes → ranked shortlist; founders who've never interviewed get AI-drafted questions | Launch → Scale |
| **B. Solo HR generalist / SME** | One person covering hiring for 5–6 departments | Shared pipeline + role-based access kills the "forward me the resume" loop; scorecards cut debriefs from 30→10 min | Scale → Pro |
| **C. Volume / deadline hiring** (retail, F&B, BPO, agencies) | 20+ near-identical hires before a store/branch opens | Auto-parse + score at volume; **WhatsApp reminders** cut no-shows; offer templates keep terms consistent | Scale / Pro |

**Primary geography:** Southeast Asia (Malaysia first — JobStreet, WhatsApp-first candidates, SSM-registered entity), expanding to SG/PH/ID. This is a genuine moat vs. US-built ATSes that ignore JobStreet and WhatsApp. **Do not dilute early spend into the US** where Greenhouse/Lever brand gravity is strongest.

**Buyer vs. user:** buyer = founder / HR lead / TA lead. Champion = whoever feels the resume pile daily. Aim messaging at the champion, pricing/ROI at the buyer.

---

## 3. Messaging & offers by funnel stage

- **Awareness (problem-aware):** "Still shortlisting in a spreadsheet?" — the cost of tool-stitching, no-shows, and slow decisions.
- **Consideration (solution-aware):** explainable AI scoring, one pipeline, minutes-not-weeks setup; head-to-head vs. Workable/Greenhouse.
- **Decision (product-aware):** free trial + credits, ROI (hours saved, faster time-to-hire), migration is painless (no data to move).

**Core offers to test:**
1. **Free trial** (self-serve, credit-based — already in product) — the primary conversion path.
2. **"Screen your next role free"** — bounded credit grant tied to one real open role (activation-forcing).
3. **Concierge migration / white-glove onboarding** for Segment B/C deals worth a demo.
4. **Founding-customer / regional launch pricing** to seed logos and case studies.

---

## 4. Channels & motions (ranked by fit)

### 4.1 SEO + content — _primary, compounding, already underway_
We already have a **28-page commercial topic cluster** (pillar `/` → product + solutions pages) and a **daily blog**. Leverage, don't rebuild:
- Prioritize the cluster pages by **volume × conversion intent** — install DataForSEO and re-run `/seo cluster` for volume-weighted ordering (flagged as missing in `docs/seo/cluster-plan.md`).
- Win the **comparison / "alternative to" queries** ("Workable alternative", "Greenhouse for startups", "ATS with WhatsApp / JobStreet integration") — highest commercial intent, and where our regional wedge ranks easily.
- Build **bottom-funnel calculators/templates** as link + capture assets: interview scorecard template, hiring funnel/cost-per-hire calculator, job description generator.
- **AI/LLM answer visibility (GEO):** structured data is already in place; add crisp, quotable FAQ answers so Aster surfaces in ChatGPT/Perplexity "best ATS for small teams" answers.

### 4.2 Product-led growth — _the core acquisition engine_
Self-serve trial + credits already exists. Make the funnel convert:
- **Time-to-value < 10 minutes:** post a role → import/receive resumes → see a ranked shortlist. That first ranked shortlist is the activation "aha" — instrument it as the North Star activation event.
- **Free-tier / free-trial loops** with natural virality: branded career site (`jobs.hireaster.com/{slug}`) and **embeddable job-board/apply widgets** put "Powered by Aster" in front of every candidate — a built-in acquisition surface. Make attribution on those links first-class.
- In-product prompts to invite hiring managers (each invite = a new seat and a potential champion at another company later).

### 4.3 Founder-led & outbound sales — _for Segment B/C_
- Targeted outbound to companies **actively hiring** (scrape/monitor JobStreet, LinkedIn Jobs, Glints postings — a company with 5 open roles has the pain today).
- Personalized loom/demo: "I screened your open [role] posting through Aster — here's the ranked shortlist." Show, don't tell.
- Warm founder network + regional startup ecosystems (see Community below).

### 4.4 Partnerships & channel
- **Job boards:** deepen JobStreet/LinkedIn posting integrations; co-marketing where possible.
- **Ecosystem partners:** startup accelerators/incubators (Cradle, MaGIC-successors, Antler, Y-Combinator SEA cohorts), coworking spaces, SME associations, HR/payroll tools (integration + referral).
- **Agencies & consultants:** recruitment agencies and HR consultants as resellers/affiliates.

### 4.5 Community & brand
- Regional HR/TA communities (LinkedIn groups, Slack/Telegram HR communities, PeopleOps meetups).
- Founder communities where hiring pain is acute (indie hackers, local startup Slacks).
- Thought leadership from a named founder/operator voice on LinkedIn — the region's HR audience lives on LinkedIn.

### 4.6 Paid — _amplifier, not foundation_
- **Search:** capture high-intent bottom-funnel terms and competitor/alternative queries. Start small, scale on proven CAC:LTV.
- **LinkedIn:** best B2B targeting for HR/founder titles in target geos; retarget site visitors.
- **Meta/WhatsApp:** viable for Segment C (volume hiring) given the WhatsApp-native audience.
- Gate scaling on payback < ~6–9 months.

---

## 5. Acquisition funnel & metrics

**Funnel:** Visitor → Trial signup → Activated (first ranked shortlist / first role posted) → Paying → Expansion (more seats/roles/credits) → Advocate (referral, review).

**North Star:** _Active hiring workspaces_ (workspaces that posted a role and screened candidates in the last 30 days).

| Stage | Primary metric | Early target to validate |
|---|---|---|
| Acquisition | Trial signups / week; CAC by channel | Establish baseline, then 15–20% MoM |
| Activation | % trials reaching first ranked shortlist | > 40% |
| Revenue | Trial → paid conversion; ARPA | > 5–10% self-serve |
| Retention | Logo & net revenue retention; monthly active workspaces | NRR > 100% |
| Referral | % of new signups from career-site/widget/referral | Growing share |

Instrument every apply link and career-site view (source tracking already exists in-product) so channel CAC is measurable from day one. **Don't scale any channel before its activation and payback numbers clear.**

---

## 6. 90-day execution plan

**Phase 1 — Foundation & activation (Weeks 1–4)**
- Instrument the funnel end-to-end; define & track the activation event (first ranked shortlist).
- Fix trial time-to-value: audit signup → first shortlist for friction; add an empty-state/sample-role path so a trial can reach "aha" without waiting for real applicants.
- Publish/optimize the top 5 highest-intent cluster + comparison pages ("Workable/Greenhouse alternative", "ATS for startups", "ATS with WhatsApp/JobStreet").
- Ship 2 lead-magnet assets (scorecard template, cost-per-hire calculator).
- Stand up analytics dashboard (signups, activation %, source CAC).

**Phase 2 — Channel proof (Weeks 5–8)**
- Launch founder-led outbound to 100 actively-hiring SMEs/startups in Malaysia (JobStreet/LinkedIn-sourced) with the "I screened your role" demo.
- Turn on a small paid search + LinkedIn test ($X capped) against bottom-funnel and competitor terms.
- Sign 1–2 ecosystem partners (an accelerator or coworking space) for co-marketing / member offer.
- Ship 5–10 case-study-shaped blog posts + 3 founding-customer testimonials.
- Add in-product invite/referral loop; ensure "Powered by Aster" on career sites/widgets links back.

**Phase 3 — Scale what works (Weeks 9–12)**
- Double down on the 1–2 channels with best CAC:activation; cut the rest.
- Launch a review-site presence (G2 / Capterra) with a review-generation motion from happy trials.
- Formalize an affiliate/referral program for agencies & consultants.
- Regional launch push (PR + LinkedIn + partner amplification) around a founding-customer milestone.
- Set MoM growth targets and a paid-scaling gate tied to payback.

---

## 7. Budget shape (allocate to proof, not vanity)

Directional split for an early-stage budget; rebalance monthly on CAC data:
- **40% Content/SEO + PLG tooling** (compounding, lowest CAC) — writers, calculators, landing pages, funnel instrumentation.
- **25% Founder-led/outbound** — sales time + tooling (hiring-signal data, sequencing).
- **20% Paid** (search + LinkedIn), strictly gated on payback.
- **15% Partnerships/community/PR** — accelerator deals, events, review-site presence.

---

## 8. Risks & guardrails

- **AI-scoring trust & fairness:** lead with "explainable score + reasons," never a black-box number. Be ready with a bias/fairness stance — it's a buyer objection and a compliance question.
- **Data/PDPA & privacy:** workspace-scoped data, export/delete, "never train shared models" — make this prominent; it's a real objection in HR software.
- **Undifferentiated messaging:** avoid generic "AI recruiting" claims; the regional wedge (JobStreet/WhatsApp/minutes-to-setup) is the sharpest edge — don't bury it.
- **Activation cliff:** trials that never see a ranked shortlist churn silently. The sample-role/empty-state fix in Phase 1 is the single highest-leverage growth task.

---

## 9. What to do first (this week)

1. Stand up the funnel dashboard and lock the activation definition.
2. Audit trial time-to-value and remove the biggest friction to first ranked shortlist.
3. Ship the two highest-intent comparison/alternative pages.
4. Start the "I screened your open role" outbound list from live JobStreet/LinkedIn postings.

_Everything else compounds off getting a trial to its first ranked shortlist and being able to prove where that trial came from._
