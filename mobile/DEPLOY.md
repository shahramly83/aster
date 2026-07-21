# Publishing Aster to the App Store & Google Play

The repo is prepped: Expo SDK 54, EAS Build configured, `version` set to `1.0.0`,
bundle IDs `com.hireaster.mobile` (both platforms), icons/splash in place, and
`eas.json` has a `production` build profile + a `submit` profile ready to fill in.

You handle the accounts and interactive commands; everything in the repo is done.

---

## 0. One-time: Expo + EAS CLI

```bash
cd mobile
npx eas login          # your (free) Expo account — create one at expo.dev if needed
npx eas init           # links this project to EAS and writes the projectId into app.json
```

`eas-cli` is already available via `npx` (no global install needed).

---

## 1. Fill in the placeholders in `eas.json`

`eas.json → submit.production` currently has `REPLACE_WITH_...` placeholders.

### iOS values
- **appleId** — the Apple ID email of your Apple Developer account.
- **appleTeamId** — App Store Connect → top-right account → **Membership** → *Team ID*
  (10-char string like `A1B2C3D4E5`). Also visible at developer.apple.com/account.
- **ascAppId** — the numeric App ID created in step 2 below (App Store Connect →
  your app → **App Information** → *Apple ID*, e.g. `6480001234`).

> Alternative (more robust) to appleId/appleTeamId: an **App Store Connect API key**
> (`.p8`). If you'd rather use that, tell me and I'll switch the config.

### Android value
- **serviceAccountKeyPath** — points to `./google-play-service-account.json`
  (git-ignored). Create it in step 3 below and drop the JSON at `mobile/`.
- **track** — `internal` for the first upload (safest). Later change to `production`.

---

## 2. Create the app records (one-time, in each console)

### App Store Connect (Apple)
1. https://appstoreconnect.apple.com → **Apps → +** → New App.
2. Platform iOS, Name `Aster`, Bundle ID `com.hireaster.mobile`
   (register it first at developer.apple.com → Certificates, IDs & Profiles → Identifiers if it isn't listed).
3. Copy the **Apple ID** number it assigns → that's your `ascAppId`.

### Google Play Console
1. https://play.google.com/console → **Create app**.
2. App name `Aster`, default language, App/Game = App, Free/Paid.
3. The package name `com.hireaster.mobile` is claimed on your first upload.

---

## 3. Google Play API access (for `eas submit`)

1. Play Console → **Setup → API access** → create/link a Google Cloud project.
2. Create a **service account**, grant it access, then in Play Console give it the
   *Release* permissions (Admin is simplest to start).
3. Download its **JSON key**, save it as `mobile/google-play-service-account.json`
   (already git-ignored — never commit it).

> First-upload note: a brand-new Play app sometimes requires the very first AAB to be
> uploaded **manually** in the console before the API will accept submissions. If
> `eas submit` errors on the first try, download the build artifact and upload it once
> by hand, then API submits work thereafter.

---

## 4. Build (on Expo's servers — no Xcode/Android Studio needed)

```bash
cd mobile
npx eas build --platform all --profile production
```

- iOS → EAS creates/manages the distribution certificate + provisioning profile
  (say yes to the prompts). Produces an `.ipa`.
- Android → EAS generates and stores the upload keystore. Produces an `.aab`.
- `autoIncrement` bumps `buildNumber`/`versionCode` automatically each build.

Do one platform at a time with `--platform ios` / `--platform android` if you prefer.

---

## 5. Submit

```bash
npx eas submit --platform android --profile production
npx eas submit --platform ios --profile production
```

- Android → uploads the `.aab` to the **internal** track (per `eas.json`).
- iOS → uploads to App Store Connect; the build lands in **TestFlight** first.

---

## 6. Store listing + review (done in the consoles, not the repo)

Both stores block release until these are complete:

**Shared**
- App icon (have it), screenshots, short + full description, category.
- **Privacy policy URL**: `https://hireaster.com/legal/privacy`.

**Apple (App Store Connect)**
- Screenshots for 6.7" and 6.5" iPhones (and 12.9" iPad since `supportsTablet: true`).
- **App Privacy** questionnaire (data collected: account email, usage).
- A **demo reviewer login** (a working test account) — Apple rejects apps they can't sign into.
- Submit for review from the app's version page.

**Google (Play Console)**
- Phone + (tablet) screenshots, feature graphic (1024×500).
- **Data safety** form, **content rating** questionnaire, target audience.
- Promote the build from `internal` → `production` when ready, then roll out.

---

## Future releases

- Bump `version` in `app.json` (e.g. `1.0.1`) for a user-facing version change.
- `buildNumber`/`versionCode` auto-increment via EAS, so you don't touch them.
- Repeat steps 4–5. OTA JS-only changes can instead ship via `eas update` on the
  `production` channel without a new store build.
