# Aster mobile — Maestro end-to-end flows

[Maestro](https://maestro.mobile.dev) drives the real Expo build in a simulator,
emulator, or a USB device. No code changes are needed to run these.

## Why Maestro (and not Detox)

The app ships **zero `testID` props**, so these flows select elements by their
**visible text** and, for a handful of controls, by `accessibilityLabel`. Maestro
matches both out of the box, which makes it the lowest-friction choice for a
codebase that wasn't instrumented for testing. A few controls are icon-only with
neither text nor a label (the discussion send arrow, the header gear/bell); those
steps tap by screen position and are commented as such. If you later add testIDs
to those controls, replace the positional taps with `id:` selectors.

## Install & prerequisites

```bash
curl -fsSL "https://get.maestro.mobile.dev" | bash   # macOS/Linux
# Windows: use WSL, or see maestro.mobile.dev/getting-started/installing-maestro
```

You need a **running app** on a booted device:

```bash
cd mobile
npm install
npm run android   # or: npm run ios   (boots Metro + installs the dev client)
```

The app id is `com.hireaster.mobile` (see `config.yaml`).

## Run

```bash
# From the repo root. Provide the real password for the demo tenant.
maestro test -e ASTER_PASSWORD='<password>' mobile/.maestro

# One flow:
maestro test -e ASTER_PASSWORD='<password>' mobile/.maestro/00-sign-in.yaml

# Different account:
maestro test -e ASTER_EMAIL=you@co.com -e ASTER_PASSWORD='...' mobile/.maestro

# Watch/iterate a single flow:
maestro test --continuous mobile/.maestro/03-scorecard.yaml
```

`ASTER_EMAIL` defaults to the seeded demo tenant `tenant@onlazy.com`.
`ASTER_PASSWORD` has no default — you must pass it.

## The flows

| File | Type | Covers |
|---|---|---|
| `subflows/login.yaml` | subflow | shared sign-in (idempotent; no-ops if already in) |
| `00-sign-in.yaml` | positive | valid sign-in reaches the app |
| `01-sign-in-negative.yaml` | negative | button disabled until both fields; bad password refused |
| `02-review-candidate.yaml` | positive | Positions → role → candidate → profile tabs |
| `03-scorecard.yaml` | positive + negative | Submit gated until all four areas rated, then enables |
| `04-offer-sheet.yaml` | negative | Compose/Upload modes; upload is web-only; empty terms refused |
| `05-discussion.yaml` | positive | open the panel thread and post a message |
| `06-notifications.yaml` | positive | header bell opens Notifications (clears the badge) |
| `07-credits-modal.yaml` | positive | dashboard AI-credits breakdown; "managed on web" note |
| `08-settings-signout.yaml` | positive | Settings preferences, then sign out to the auth screen |
| `09-today-interviews.yaml` | positive | the Interviews/Today segmented tabs render and switch |

## Notes on data & safety

- These flows are **read-mostly**. `03-scorecard` stops before submitting;
  `04-offer-sheet` stops before sending; `05-discussion` **does post a real
  message** to the panel thread of the first candidate — run it against a
  throwaway workspace.
- Flows that depend on workspace state (an open role, a candidate at the decision
  stage) are wrapped in `runFlow: when:` guards, so they **no-op instead of
  failing** when the demo data isn't in that state. Seed the workspace (see
  `mobile/STORE-SUBMISSION.md` / `lazy_workspace.sql`) for full coverage.
- Biometric lock auto-dismisses on devices with no enrolled biometrics; the login
  subflow handles the `Unlock` screen if it appears.

## Highest-value improvement

Add `testID` props to the icon-only controls (discussion send arrow, header
gear/bell, star toggle, back arrows, inactive tab icons) and the primary CTAs.
That removes every positional tap in these flows and makes them robust to layout
changes.
