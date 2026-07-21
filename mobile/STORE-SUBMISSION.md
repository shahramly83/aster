# Aster mobile: store submission privacy answers

Reference for App Store Connect and Google Play Console. Derived from what the
Aster recruiter app actually does (Supabase auth, biometric unlock, push
notifications, candidate profiles / scorecards / offers). No in-app payments;
billing is handled on the web.

Legal entity: **Oryx Digital Sdn Bhd**, trading as Aster (Malaysia). Governing
law: Malaysia; privacy framework: PDPA 2010 (plus GDPR/UK GDPR for EU/UK users).

Legal URLs (already prerendered, live at build):
- Privacy policy: https://hireaster.com/legal/privacy
- Terms of service: https://hireaster.com/legal/terms

---

## Google Play: Data safety form

### Does your app collect or share any of the required user data types? **Yes**

### Is all user data encrypted in transit? **Yes**
### Do you provide a way for users to request data deletion? **Yes**
(In-app deletion of workspace/candidate data, plus legal@hireaster.com.)

### Data types collected

| Category | Data type | Collected | Shared | Purpose | Optional? |
|---|---|---|---|---|---|
| Personal info | Name | Yes | No | Account management, app functionality | Required |
| Personal info | Email address | Yes | No | Account management, app functionality | Required |
| Personal info | Other info (candidate names / contact details in resumes) | Yes | No | App functionality | Required |
| App activity | App interactions | Yes | No | Analytics, app functionality | Required |
| App info & performance | Crash logs | Yes | No | Diagnostics | Required |
| App info & performance | Diagnostics | Yes | No | Diagnostics | Required |
| Device or other IDs | Device or other IDs (push token) | Yes | No | App functionality (notifications) | Required |

Notes:
- **Financial info: not collected in-app.** Card data is handled by the web
  payment processor, never by the mobile app.
- **Biometrics (Face ID / fingerprint): do NOT declare.** Unlock is performed by
  the OS on-device; the app never accesses or transmits biometric data.
- **"Shared" = No everywhere.** Infrastructure vendors (Supabase, Anthropic,
  etc.) are service providers processing on Aster's behalf, which Play's Data
  safety guidance excludes from "sharing."

---

## Apple App Store Connect: App Privacy labels

### Data used to track you: **None** (Aster does not track across other apps/sites)

### Data linked to you

| Data type | Category | Purpose | Tracking? |
|---|---|---|---|
| Name | Contact Info | App Functionality | No |
| Email Address | Contact Info | App Functionality | No |
| User ID | Identifiers | App Functionality | No |
| Other User Content (candidate resumes / applicant data) | User Content | App Functionality | No |
| Product Interaction | Usage Data | Analytics | No |

### Data not linked to you

| Data type | Category | Purpose |
|---|---|---|
| Crash Data | Diagnostics | App Functionality |
| Performance Data | Diagnostics | App Functionality |

Notes:
- **Face ID:** covered by `NSFaceIDUsageDescription` in app.json. It is an
  on-device authentication API, not data collection; do not add a privacy label
  for it.
- **EULA:** you may use the default Apple EULA, or link the Aster Terms of
  Service (https://hireaster.com/legal/terms) as a custom EULA in the app's
  License Agreement field.
- Set the **Privacy Policy URL** to https://hireaster.com/legal/privacy in both
  the app's metadata and App Privacy section.

---

## Pre-submission checklist
- [ ] Privacy Policy URL set in Play listing + App Store Connect
- [ ] Play Data safety form completed (table above)
- [ ] Apple App Privacy labels completed (tables above)
- [ ] Terms/EULA linked in App Store Connect License Agreement (optional but recommended)
- [x] Legal entity name + jurisdiction filled into /legal/privacy and /legal/terms (Oryx Digital Sdn Bhd, Malaysia)
