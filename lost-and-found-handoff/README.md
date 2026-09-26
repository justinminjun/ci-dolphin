# Lost & Found — Handoff Package

Updated Lost & Found tab for the Dolphin app (Expo / React Native, one codebase for
iOS, Android and web). This package contains **only the Lost & Found files** plus the
two small shared helpers they depend on. Paths mirror the project root of
`dolphin-main-v1.4.0`, so files can be copied over in place.

> Because the app and website share one codebase, these changes affect **both** the
> native app and the website once merged. They were tested on the website only (see
> "Testing" below) — please test on an iOS/Android build before shipping.

---

## 1. How to apply

1. Copy `src/` from this package over the project's `src/` (same paths).
2. Delete `src/lostandfound/utils/timeAgo.ts` (no longer used).
3. Apply the notifications change (lets users open a post from a "possible match"
   notification):
   ```bash
   git apply patches/NotificationsScreen-lf_match.patch
   ```
   (run from the project root; it adds ~12 lines to `src/screens/NotificationsScreen.tsx`)
4. `npx tsc --noEmit` — should report no errors in `src/`.

No new npm packages are required.

## 2. Files

| File | Status | Notes |
|---|---|---|
| `src/screens/LostFoundScreen.tsx` | modified | Feed |
| `src/lostandfound/screens/AddPostScreen.tsx` | modified | Create / edit post |
| `src/lostandfound/screens/DetailScreen.tsx` | modified | Post detail |
| `src/lostandfound/utils/gemini.ts` | modified | Category list shared with the form; passes image MIME type |
| `src/lostandfound/utils/constants.ts` | **new** | Campus zones, categories, stale-post rules |
| `src/lostandfound/utils/matching.ts` | **new** | Lost ↔ found matching |
| `src/lostandfound/i18n.ts` | **new** | English / Korean strings for the L&F screens |
| `src/components/HoverCard.tsx` | **new (support)** | Hover lift on feed cards (web only; no-op on native) |
| `src/utils/useResponsive.ts` | support | Adds `useHover()`; `useIsWebDesktop()` returns `false` on native |
| `src/lostandfound/{config,theme}/*`, `utils/admin.ts`, `utils/notifications.ts`, `utils/userRole.ts` | unchanged | Included so the module is complete |
| `patches/NotificationsScreen-lf_match.patch` | patch | See step 3 |

Shared files the L&F screens use but that are **not** included (unchanged, already in
the app): `src/config/firebase.ts`, `src/theme/theme.ts`, `src/utils/moderation.ts`, and
the `LFDetail` / `LFAddPost` routes in `src/navigation/AppNavigator.tsx`.

## 3. What changed

**Posting**
- **Location = Zone + Detail.** Zone is picked from a fixed list of campus areas (keeps
  posts filterable on a large campus); "Other" allows a custom area name. An optional
  free-text detail field holds specifics ("2nd floor, near room 204"). The zone list is in
  `utils/constants.ts` (Korean labels in `i18n.ts`) — edit to match actual building names.
- **Found items: "I dropped it off" vs "I'm holding it."** Finders who keep the item are
  no longer forced to pick a drop-off spot; the post shows "Finder is holding this item"
  and prompts others to message them.
- **Category and color** fields (AI pre-fills them when available). Previously the
  category was never saved, so the feed's category filter matched nothing.
- Close button + header; after posting, the new post opens directly.

**Finding**
- **Possible matches:** each active post shows similar opposite-type posts (category,
  AI tags, title words, color, zone, dates). When a new post is created, authors of the
  top matches get an in-app notification (`dolphin_notifications`, type `lf_match`).
  In-app bell only — no push.
- **Filters & sorting:** zone filter row, sort by Newest / Oldest / Date lost-found,
  search also covers color, category, zone and location detail.
- **Old posts:** active posts with no activity for 30 days (`STALE_DAYS`) are tucked
  behind "Show N older posts". Owners see a banner to **bump** the post back to the top
  or mark it resolved. Bump is also in the owner menu.
- **EN / 한 toggle** in the feed header (applies to all L&F screens, remembered per device).
- Detail screen updates live (edits / bumps / resolves appear immediately).

**Fixes & quality**
- Role badge: students were all labelled "Faculty" on feed cards (now uses the email
  pattern from `userRole.ts`, same as the detail screen).
- Web: photo upload (the native file-system uploader doesn't exist in browsers), photo
  picker, layouts sized from measured width (sidebar / resize safe), desktop-width detail
  and form layouts.
- Accessibility: labels / roles / selected states on all interactive elements; small
  green text darkened to `#047857` to meet WCAG AA contrast.

## 4. Data model (Firestore `posts`)

New fields written by the form (all optional for older posts):

| Field | Type | Notes |
|---|---|---|
| `category` | string | One of `LOSTFOUND_CATEGORIES` (default `Other`) |
| `locationZone` | string | One of `LOSTFOUND_ZONES` |
| `locationZoneCustom` | string | Custom area name when zone is `Other` |
| `locationDetail` | string | Free-text specifics |
| `foundStatus` | `'dropped_off' \| 'holding' \| ''` | Found posts only |
| `bumpedAt` | timestamp | Set by the owner's "bump"; feed sorts by `bumpedAt ?? createdAt` |

`location` is still written as a combined display string (e.g. `Library — 2nd floor`), so
older clients and older posts keep working. Older posts without `locationZone` still show
their original location text, but won't appear under a specific zone filter (optional
backfill).

New notification type in `dolphin_notifications`: `{ type: 'lf_match', postId, recipientId, title, body, read, createdAt }`.

**Rules / indexes to check**
- Matching query: `posts` where `postType == X` and `status == 'active'` — equality-only,
  no composite index needed.
- Clients create `dolphin_notifications` docs for other users (same pattern the Market
  and Chat screens already use) and owners update `bumpedAt` on their own posts. Both
  worked against the current rules in testing.

## 5. Testing

Tested on the website (localhost) with a real school account against the live project:
create post with photo (Storage upload), edit, bump, mark resolved, delete; feed filters,
sorting, older-posts toggle, EN/KO toggle, matches section, desktop and phone widths.
The test post was deleted afterwards.

**Not yet tested:** native iOS/Android build; delivery of an `lf_match` notification
(avoided on purpose to not notify real users); the 30-day banner on a real old post.

## 6. Action items (outside the L&F code)

1. **Gemini API key has been disabled by Google as leaked** (403 "API key was reported
   as leaked"). AI photo analysis is currently failing for everyone; posting still works
   without it. The key is hard-coded in `eas.json`, `functions/src/menuSync.ts` and
   `scripts/sync_lunch_menu.mjs` and was exposed in a public repository.
   Recommended: create a new key, keep it out of source control (EAS secrets /
   Functions secrets), and ideally call Gemini from a Cloud Function — any
   `EXPO_PUBLIC_*` key is readable by anyone who opens the website or app bundle.
2. **Deleting a post leaves its photos in Storage** (existing behaviour in the app too).
   Consider a Storage cleanup on post delete. One test image from website testing can be
   removed: `posts/1790416412722-*.jpg`.
