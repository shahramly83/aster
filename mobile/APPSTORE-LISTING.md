# Aster iOS: App Store Connect listing guide

Everything needed to fill the App Store Connect listing after `eas submit` uploads
the build. Privacy answers live in [STORE-SUBMISSION.md](./STORE-SUBMISSION.md);
this file is the listing + review metadata. Legal entity: **Oryx Digital Sdn Bhd**
(Malaysia), trading as Aster. No in-app purchases (billing is web-only).

---

## 1. App information (App Store Connect > App Information)

| Field | Value |
|---|---|
| Name | **Aster** |
| Subtitle (30 char) | **Hire faster with AI screening** |
| Bundle ID | `com.hireaster.mobile` |
| SKU | `aster-ios` |
| Primary language | English (U.S.) |
| Primary category | **Business** |
| Secondary category | Productivity |
| Content rights | Does not use third-party content |
| Age rating | Complete questionnaire -> expected **4+** (no objectionable content) |

---

## 2. Pricing and availability
- **Price:** Free
- **Availability:** All countries/regions (or restrict to your markets)
- No in-app purchases. Subscriptions are handled on the web (hireaster.com).

---

## 3. Screenshots (required)

`app.json` has `supportsTablet: true`, so **iPad screenshots are required** in
addition to iPhone. If you would rather skip iPad, set `ios.supportsTablet: false`
in app.json and rebuild (one-line change) -- then only iPhone is needed.

| Device | Pixel size (portrait) | Required | Count |
|---|---|---|---|
| iPhone 6.9" (15/16 Pro Max) | 1320 x 2868 | Yes (or 6.7") | 3-10 |
| iPhone 6.7" (14/15 Pro Max) | 1290 x 2796 | Accepted for the above | 3-10 |
| iPad 13" | 2064 x 2752 | Yes (tablet enabled) | 3-10 |

- One iPhone set (6.9" **or** 6.7") covers all iPhones; Apple down-scales.
- Suggested shots: Dashboard, Pipeline, Candidate profile + AI insight, Interview
  scheduling, Offer. 5 is plenty.
- No status bar mockups with fake carrier/battery that misrepresent; a clean
  device frame or raw screenshot is fine.

---

## 4. Description (max 4000 char) -- ready to paste

```
Aster is the AI hiring platform that helps small teams hire without the busywork. Post a job, collect applications, and let Aster screen every resume, rank candidates by fit, and draft interview questions, so you spend minutes, not days, getting to the right people.

WHAT YOU CAN DO
- Screen resumes automatically and see a ranked shortlist with clear reasons
- Track every candidate through one simple pipeline: applied, interview, offer, hired
- Schedule interviews, collect scorecards, and keep your panel aligned in one place
- Send and sign offer letters natively, no third-party tools
- Get instant AI insights and suggested interview questions for any candidate
- Unlock the app quickly and securely with Face ID

BUILT FOR REAL HIRING
Aster reads the CVs you already have, matches them to your open roles, and keeps your whole team on the same page. No spreadsheets, no 40 open tabs.

Subscriptions are managed on the web at hireaster.com. The app contains no in-app purchases.

Privacy Policy: https://hireaster.com/legal/privacy
Terms of Service: https://hireaster.com/legal/terms
```

### Promotional text (max 170 char, editable anytime without review)
```
Hire faster with AI. Aster screens every resume, ranks candidates by fit, and keeps your pipeline, interviews, and offers in one place.
```

### Keywords (max 100 char, comma-separated, no spaces after commas)
```
recruiting,hiring,ATS,resume,screening,candidates,interview,applicant tracking,HR,talent,offer,jobs
```

### URLs
| Field | Value |
|---|---|
| Support URL | https://hireaster.com |
| Marketing URL (optional) | https://hireaster.com |
| Privacy Policy URL | https://hireaster.com/legal/privacy |
| Copyright | 2026 Oryx Digital Sdn Bhd |

---

## 5. App Review Information

The app requires sign-in, so App Review needs a working demo account.

| Field | Value |
|---|---|
| Sign-in required | **Yes** |
| Demo username | `tenant@onlazy.com` |
| Demo password | **<fill in>** (seed via `supabase/seed/lazy_workspace.sql`) |
| Contact first/last name | Shah (your name) |
| Contact phone | your number |
| Contact email | support@hireaster.com (or legal@hireaster.com) |

**Review notes (paste):**
```
Aster is a recruitment app for hiring teams. Sign in with the demo account above to see a seeded workspace with jobs, candidates, a pipeline, and interviews. All billing/subscriptions are handled on our website (hireaster.com); the app has no in-app purchases. Face ID is used only for on-device app unlock. Data deletion: in-app plus legal@hireaster.com.
```

---

## 6. App Privacy labels
Fill from the tables in [STORE-SUBMISSION.md](./STORE-SUBMISSION.md) section
"Apple App Store Connect: App Privacy labels":
- **Tracking:** None
- **Data linked to you:** Name, Email, User ID, Other User Content, Product Interaction
- **Data not linked to you:** Crash Data, Performance Data
- Do **not** declare Face ID (on-device auth API, not data collection).

---

## 7. Export compliance (asked at each submission)
Aster uses only standard HTTPS/TLS encryption -> **exempt**. To stop Apple asking
every submission, add to `app.json` under `ios.infoPlist`:
```json
"ITSAppUsesNonExemptEncryption": false
```
(Optional; requires a rebuild to take effect. Otherwise just answer "No" to
"Does your app use non-exempt encryption?" each time.)

---

## 8. Order of operations
1. `npx eas submit --platform ios --latest` -> uploads build, creates app record.
2. Processing in App Store Connect takes ~15-30 min before the build is selectable.
3. Fill sections 1-7 above, attach the build under "Build".
4. **Submit for Review.** First review typically 24-48h.

## Pending / follow-ups
- [ ] **APNs key** for iOS push delivery (build ships without it; push stays off on
      iOS until added via `eas credentials` -> iOS -> Push Key). Does not block review.
- [ ] Demo account password confirmed and seeded before submitting for review.
- [ ] Decide iPad: provide iPad 13" screenshots, or set `supportsTablet: false` + rebuild.
