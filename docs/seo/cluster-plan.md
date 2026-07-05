# Aster — Topic Cluster Plan

Generated 2026-07-06 · Base domain https://hireaster.com · 28 pages

## Methodology & honesty note

Keywords were grounded with **live Google SERP checks** on the head terms (July 2026) to read competitor set and intent, then clustered by **search intent + SERP composition**. Every head term here returns **vendor landing pages + "best-of" listicles** — i.e. commercial intent — so the correct architecture for a SaaS product site is a **keyword→landing-page map** (one primary keyword per existing page), not a blog hub-and-spoke. Exhaustive *pairwise* SERP-overlap scoring and exact **search volume / difficulty** need the DataForSEO extension (not installed); numbers below are intent-based, not volume-ranked. Install DataForSEO and re-run `/seo cluster` for volume-weighted prioritisation.

## Architecture

- **Pillar:** `/` → *AI recruitment software* (broadest commercial term)
- **Product cluster** (`/product` hub + 11 feature pages) → feature keywords (ATS, AI screening, automation, analytics…)
- **Solutions cluster** (`/solutions` hub + 14 segment pages) → persona / stage / industry keywords

### Pillar

| URL | Primary keyword | Intent |
|---|---|---|
| `/` | AI recruitment software | Commercial |

### Product

| URL | Primary keyword | Intent |
|---|---|---|
| `/product` | all-in-one recruiting software | Commercial |
| `/product/sourcing` | candidate sourcing software | Commercial |
| `/product/ats` | applicant tracking system | Commercial |
| `/product/ai` | AI resume screening software | Commercial |
| `/product/interviews` | interview scorecard software | Commercial |
| `/product/offers` | offer management software | Commercial |
| `/product/analytics` | recruitment analytics software | Commercial |
| `/product/career-site` | career site builder | Commercial |
| `/product/collaboration` | collaborative hiring software | Commercial |
| `/product/automation` | recruitment automation software | Commercial |
| `/product/integrations` | recruiting software integrations | Commercial |
| `/product/changelog` | Aster product updates | Commercial |

### Solutions

| URL | Primary keyword | Intent |
|---|---|---|
| `/solutions` | recruitment software solutions | Commercial |
| `/solutions/recruiters` | recruiting software for recruiters | Commercial |
| `/solutions/hiring-managers` | hiring software for hiring managers | Commercial |
| `/solutions/talent-leaders` | talent acquisition software | Commercial |
| `/solutions/people-ops` | HR recruiting software | Commercial |
| `/solutions/founders` | hiring software for founders | Commercial |
| `/solutions/startups` | recruiting software for startups | Commercial |
| `/solutions/scaleups` | recruiting software for scaleups | Commercial |
| `/solutions/enterprise` | enterprise recruiting software | Commercial |
| `/solutions/agencies` | recruitment software for staffing agencies | Commercial |
| `/solutions/industries/technology` | tech recruiting software | Commercial |
| `/solutions/industries/healthcare` | healthcare recruitment software | Commercial |
| `/solutions/industries/retail` | retail recruitment software | Commercial |
| `/solutions/industries/professional-services` | professional services recruiting software | Commercial |
| `/solutions/industries/manufacturing` | manufacturing recruitment software | Commercial |

## Internal link matrix

Every feature/segment page links **up** to its hub and the hub links **down** to each child. Key cross-links (spoke↔spoke) reinforce topical relationships:

| From | To (cross-links) |
|---|---|
| `/` | `/product/ai`, `/product/ats`, `/signup` |
| `/product` | `/product/sourcing`, `/product/ats`, `/product/ai`, `/product/interviews`, `/product/analytics` |
| `/product/sourcing` | `/product/ai`, `/solutions/recruiters` |
| `/product/ats` | `/product/automation`, `/product/collaboration`, `/solutions/hiring-managers` |
| `/product/ai` | `/product/sourcing`, `/solutions/recruiters`, `/solutions/industries/technology` |
| `/product/interviews` | `/product/collaboration`, `/solutions/hiring-managers` |
| `/product/offers` | `/product/analytics` |
| `/product/analytics` | `/solutions/talent-leaders` |
| `/product/career-site` | `/product/ats` |
| `/product/collaboration` | `/product/interviews`, `/solutions/people-ops` |
| `/product/automation` | `/product/ats`, `/product/integrations` |
| `/product/integrations` | `/product/automation` |
| `/solutions` | `/solutions/recruiters`, `/solutions/startups`, `/solutions/enterprise`, `/solutions/industries/technology` |
| `/solutions/recruiters` | `/product/ai`, `/product/sourcing` |
| `/solutions/hiring-managers` | `/product/interviews`, `/product/ats` |
| `/solutions/talent-leaders` | `/product/analytics`, `/solutions/enterprise` |
| `/solutions/people-ops` | `/product/collaboration`, `/solutions/enterprise` |
| `/solutions/founders` | `/solutions/startups`, `/product/ai` |
| `/solutions/startups` | `/solutions/founders`, `/solutions/scaleups` |
| `/solutions/scaleups` | `/solutions/startups`, `/solutions/enterprise`, `/product/automation` |
| `/solutions/enterprise` | `/solutions/talent-leaders`, `/product/analytics` |
| `/solutions/agencies` | `/product/sourcing`, `/product/automation` |
| `/solutions/industries/technology` | `/product/ai`, `/solutions/scaleups` |
| `/solutions/industries/healthcare` | `/product/ai`, `/solutions/agencies` |
| `/solutions/industries/retail` | `/product/automation`, `/solutions/industries/manufacturing` |
| `/solutions/industries/professional-services` | `/product/ai`, `/solutions/talent-leaders` |
| `/solutions/industries/manufacturing` | `/product/automation`, `/solutions/industries/retail` |

## Cannibalization check

No two pages share a primary keyword — **0 conflicts**. The closest pair (`/` *AI recruitment software* vs `/product/ai` *AI resume screening software*) is intentionally split: brand/category term on the homepage, feature term on the module page.

## Scorecard

| Metric | Target | This plan |
|---|---|---|
| Coverage | 100% | 28/28 pages |
| Primary-keyword conflicts | 0 | 0 |
| Orphan pages | 0 | 0 (all reachable from a hub) |
| Hub↔child links | 100% | 100% |
| Title ≤ 60 chars | 100% | 100% |
| Meta ≤ 160 chars | 100% | 100% |
