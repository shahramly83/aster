# Aster Brand Guidelines

_Source of truth for voice, messaging, and visual identity. Derived from the live product; keep in sync with `src/resume-ai-preview.jsx` (`BRAND_STYLES`)._

## 1. Brand essence

**Aster is the AI recruitment platform for growing teams.** It reads every resume, ranks applicants against the role, and handles interview scheduling, so a shortlist that used to take two weeks takes an afternoon.

- **One-liner:** Hire the right person, without reading every CV.
- **Category:** AI recruitment / applicant screening & scheduling.
- **Audience:** Teams that hire regularly, from a founder making their first hires to a people team running dozens of roles.
- **Core promise:** Start from a shortlist, not a pile.

## 2. Voice

Aster sounds like a sharp, experienced recruiter who respects your time, not a hype-y AI vendor.

| Trait | What it means | Do | Don't |
|-------|---------------|-----|-------|
| **Plain-spoken** | Concrete, everyday words | "the pile", "an afternoon", "no back-and-forth email" | "synergy", "leverage", "revolutionary AI" |
| **Confident, not hypey** | State outcomes flatly; let the result carry it | "A two-week shortlist now takes an afternoon." | "🚀 10x your hiring!!!" |
| **Empathetic to the recruiter** | Name the pain before the fix | "Drowning in CVs." → "Aster reads every CV as it arrives." | Lead with the tech / features |
| **Outcome-first** | Benefit before mechanism | "Start from a shortlist, not a pile." | "Powered by vector embeddings…" |

### Tone by context
| Context | Shift |
|---------|-------|
| Landing / marketing | Confident, a little more energetic; still restrained |
| In-app UI & labels | Clear and terse ("Post a job", "Copy job URL") |
| Empty states | Helpful + a nudge ("No one in the pipeline yet.") |
| Errors | Cause + fix, never blame ("File wasn't uploaded. Nothing added.") |
| Plan limits / upgrade | Matter-of-fact, no dark patterns |

### Quick rules
- **No em dashes (—).** They read as an AI tell and aren't part of Aster's voice. Use a comma, colon, period, or parentheses instead. (En dashes in numeric ranges, like 400–600, are fine.)
- **CV / resume:** use "resume" in UI copy (no accent). "CV" is fine in headlines/marketing.
- **Numbers:** be specific and honest ("46 applicants ranked in 3 seconds"); don't invent stats.
- **Sentence case** for buttons and headings (not Title Case, not ALL CAPS, except small eyebrow labels).
- One primary CTA per screen; secondary actions stay subordinate.

## 3. Messaging framework

- **Value proposition:** For teams drowning in CVs, Aster is an AI recruitment platform that screens, ranks, and schedules, so hiring managers start from a shortlist instead of a pile.
- **Primary message:** Hire the right person, without reading every CV.
- **Key messages (proof points):**
  - **Reads every CV:** structured skills, experience, and a one-line summary in seconds.
  - **Ranks against the role:** a match score with the reasons, strongest fits on top.
  - **Books the interviews:** one link, candidate self-books, Meet/Teams invite created automatically.
  - **One shared pipeline:** the whole team on the same board; nothing buried in an inbox.
- **Proof line:** 3× faster shortlists · 46 → 3 applicants to shortlist · ~2 weeks sooner to hire.

## 4. Visual identity

### Logo
- The **Aster star** mark plus the **"aster"** wordmark, drawn inline as a single-colour lockup via `BrandLogo` (no gradient). It recolours per surface: royal blue (`--brand`) on light, white on brand-blue / dark surfaces, solid ink on the footer.
- Clear space around the mark; never recolour outside the surface variants, stretch, or add effects.

### Color
Royal-blue brand. The whole product (marketing, app, admin) reads from these tokens, so a rebrand is a single-place change.

| Token | Hex | Use |
|-------|-----|-----|
| `--brand` | `#0B2AE0` | Primary royal blue: CTAs, accents, links |
| `--brand-2` | `#3550EE` | Secondary blue (gradient mid/end) |
| `--brand-0` | `#5570F5` | Lighter blue (gradient start) |
| `--brand-soft` | `#EAEEFE` | Tinted surfaces, chips, icon tiles |
| `--brand-deep` | `#0A1FC2` | Deepest blue: nav bar + hero top |
| `--brand-rgb` | `11, 42, 224` | `--brand` as RGB, for brand-tinted shadows/glows |
| `--ink` | `#12132A` | Primary text |
| `--ink-2` | `#4A5568` | Secondary text |
| `--ink-3` | `#6B7280` | Tertiary / captions |
| `--bg` | `#FAFAFB` | App / page background |
| `--line` / `--line-strong` | `#ECECEF` / `#DEDEE3` | Borders / dividers |

- **Brand gradient:** `linear-gradient(135deg, #5570F5 → #0B2AE0 55% → #3550EE)`.
- **Hero gradient:** `linear-gradient(180deg, #0A1FC2 → #0F27D8 55% → #1B34E6)` (`--hero-grad`).
- **Chrome:** the app sidebar and admin console are **light** (white / `--bg` with `--line` borders and blue accents), matching the marketing pages. `--navy` remains only for a few legacy dark surfaces being phased out.
- **Semantic:** success `#16A34A`, warning `#B45309`, danger `#DC2626`. Never convey meaning by color alone; pair with an icon or label.
- Target WCAG AA (4.5:1 body text). Body text uses `--ink`/`--ink-2` on light surfaces.

### Typography
- **Display / headings:** **Plus Jakarta Sans** (600–800), tracking `-0.02em` (`.font-display`).
- **Body / UI / tables:** **Inter** (400–600), tabular figures for data.
- Scale: 12 · 14 · 16 · 18 · 24 · 32+. Body ≥16px on mobile.

### Motion & surfaces
- Micro-interactions 150–300ms, ease-out; respect `prefers-reduced-motion`.
- Rounded surfaces (cards `rounded-2xl`, panels `rounded-[26px]`), soft shadows (`act-shadow`), subtle brand radial washes on page backgrounds.
- SVG icons only (one consistent stroke family); never emoji as UI icons.

## 5. Consistency checklist (before shipping copy/UI)
- [ ] Sounds like Aster (plain-spoken, confident, outcome-first)?
- [ ] No em dashes (comma / colon / period / parentheses instead)?
- [ ] Leads with the benefit, not the tech?
- [ ] Sentence case; one primary CTA?
- [ ] "resume" (not "résumé") in UI; honest numbers?
- [ ] Semantic color + icon/label (not color alone)?
- [ ] Plus Jakarta Sans headings / Inter body; AA contrast?
