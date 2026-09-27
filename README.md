# Dolphin 🐬

Dolphin is Chadwick International's campus community app — social feed, second-hand
marketplace, lost & found, direct messages, and a Local Guide of Songdo built from
student/faculty recommendations. It ships to the App Store as **CI Dolphin** and, from
the same codebase, as a website (`chadwickinternational-dolphin.web.app`).

**Active codebase:** [`dolphin-main-v1.4.0/`](./dolphin-main-v1.4.0). Everything below
refers to that folder. (An older pre-v1.4.0 snapshot, `dolphin-main/`, was removed;
it remains available in the git history.)

**Lost & Found handoff:** [`lost-and-found-handoff/`](./lost-and-found-handoff) contains
only the updated Lost & Found files, with install steps, data-model changes and open
action items in its README. The same changes are already applied in
`dolphin-main-v1.4.0/`.

---

## One codebase, two targets

This is a single Expo (React Native + `react-native-web`) project. The mobile app and
the website are not separate projects that happen to look similar — they're the same
`src/` screens and the same Firebase backend, compiled two ways:

- **Mobile**: `npx expo start` → iOS/Android via Expo Go, EAS Build for App Store/TestFlight
- **Web**: `npx expo start --web` locally, `npx expo export --platform web` + Firebase
  Hosting for production

Screens branch on `Platform.OS === 'web'` and `useIsWebDesktop()` (see
`src/utils/useResponsive.ts`) where mobile and desktop-web need different layouts —
grep for those two before assuming a screen is mobile-only.

---

## Tech stack

| | |
|---|---|
| Framework | Expo (React Native + react-native-web), TypeScript |
| Backend | Firebase — Auth, Firestore, Storage, Cloud Functions |
| Maps | `react-native-maps` (native) / `@teovilla/react-native-web-maps` (web, aliased via `metro.config.js`) |
| School calendar | Veracross API, synced hourly by a Cloud Function into Firestore |
| Navigation | React Navigation (Bottom Tabs + Native Stack; sidebar nav on desktop web) |

---

## Firebase — two projects, not one (read this before touching hosting or billing)

This is the single most important thing to understand before managing this project:

- **`lost-and-found-20c10`** — the real backend. Firestore, Auth, Storage, Cloud
  Functions. Same project the mobile app uses. This is what "the database" means
  everywhere in this repo, and it's managed by the school's tech department.
- **`chadwicklostfound-justinminjun`** — hosts *only* the static website
  (`chadwickinternational-dolphin.web.app`, Firebase Hosting). It does not hold any
  app data. This project was created separately during early web-port development and,
  going by its name, is likely tied to a personal account rather than the school's.

The web app's `.env` correctly points at `lost-and-found-20c10` for all data — so the
site already reads/writes the real, shared database. The only thing split off is
*hosting*. **Recommended cleanup**: add a Hosting site inside `lost-and-found-20c10`
itself and redeploy there, so the whole project — app data and website — lives under
one Firebase project the school owns. That removes a second billing surface and a
second thing to hand off.

---

## Running locally

```bash
cd dolphin-main-v1.4.0
npm install
cp .env.example .env       # fill in Firebase + Google Maps keys
npx expo start --web       # website
npx expo start             # mobile (Expo Go / simulator)
```

## Deploying the website

```bash
npx tsc --noEmit                              # always check types first
npx expo export --platform web
npx firebase-tools deploy --only hosting:dolphin-web
```

## Deploying the app

See `docs/PROJECT_HANDOFF.md` for the full EAS build/submit flow, known local-build
pitfalls (CocoaPods/Ruby, simulator prebuild), and OTA update usage.

---

## External dependencies that need Google Cloud / school-side access

These aren't code bugs — they're switches that need flipping in a console this repo's
maintainer may not have access to yet:

1. **Maps JavaScript API** — the website's Local Guide map needs this enabled on the
   Google Cloud project behind `EXPO_PUBLIC_GOOGLE_MAPS_KEY` (the mobile app only
   needed the Maps *SDK*, a separate enablement). Enable at
   console.cloud.google.com → APIs & Services → Library → "Maps JavaScript API".
2. **Firebase Auth authorized domains** — Google Sign-In on the web needs the hosting
   domain added under Firebase Console → Authentication → Settings → Authorized
   domains, or users can only use the "continue without signing in" test path.
3. **Veracross OAuth secret rotation** — `VERACROSS_CLIENT_ID`/`_SECRET` are currently
   committed in plaintext in `functions/src/calendarSync.ts` and
   `functions/scripts/seed_calendar.mjs`. Rotate and move to Cloud Secret Manager
   before wider handoff (see `docs/PROJECT_HANDOFF.md` for the mechanism already used
   elsewhere in this codebase).

---

## Ownership handoff (school takeover)

Since the app and website share one backend, transferring ownership is really about
transferring access to `lost-and-found-20c10` (already the school's, per their tech
department) and consolidating the pieces that currently live outside it:

- [ ] Add school IT as Owner on the `lost-and-found-20c10` Firebase/Google Cloud project
      (if not already), and confirm the website's Hosting site is migrated there per
      the section above — removing the separate `chadwicklostfound-justinminjun` project
- [ ] Transfer or add the school as admin on this GitHub repo (already private)
- [ ] Transfer the Expo/EAS account, or move builds to a school-owned EAS org — the
      personal account's free build tier is close to its limit
- [ ] Confirm Apple Developer Program / Google Play Console access includes the school
- [ ] Rotate the Veracross secret (above) before adding new maintainers
- [ ] Point new maintainers at `docs/PROJECT_HANDOFF.md` for the detailed session-by-
      session history of what's been built, fixed, and is still pending

---

## Docs

`docs/PROJECT_HANDOFF.md` is the living engineering log — architecture detail, known
issues, and a full change history. This README is the front door; that file is the
deep end.
