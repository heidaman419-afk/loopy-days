# Loopy Days

A private iPhone home-screen web app (PWA) for knitters. This version holds
**feature 1, the row counter**, **feature 2, sign-in and offline-first sync with
Supabase**, **feature 3, projects** (list, tour, drafts, project page, per-project counters,
photos, Home "continue" card and now-knitting bar), plus the app shell that later features
slot into.

Plain HTML, CSS and JavaScript ES modules. No framework, no npm, no build step, no CDN.

## Run it

There is nothing to build. Serve this folder with any static web server, for example:

```sh
python3 -m http.server 8080      # then open http://localhost:8080/
# or
npx serve .
```

Opening `index.html` straight from the disk will not work: ES modules, IndexedDB and
the service worker need `http://` or `https://`.

To publish on GitHub Pages at `https://<user>.github.io/loopy-days/`, push the contents
of this folder to the repository root. Every path is relative (`./…`), so the subpath
just works. On the iPhone: open the address in Safari, tap Share, then **Add to Home Screen**.

**After changing any file, raise `VERSION` in `sw.js` and `APP_VERSION` in `js/version.js`
together** (for example `loopy-days-v6`; they must match) and add any new file to the
`FILES` list in `sw.js`, so installed copies pick up the update. This includes filling in
`js/sync/config.js`: the app is served cache-first, so without a version bump installed
copies keep the old, empty config.

## Files

| Path | What it does |
| --- | --- |
| `index.html` | The single page: meta tags for iPhone, stylesheets, starts `js/app.js` |
| `manifest.webmanifest` | Home-screen app name, colours and icons |
| `sw.js` | Service worker: caches every file so the app opens offline |
| `css/tokens.css` | Brand colours, fonts (`@font-face`), sizes, dark mode |
| `css/base.css` | Reset, buttons, fields, chips, switches, sheets, dialogs, toast |
| `css/shell.css` | Wave header, tab bar, home tiles, empty states |
| `css/counter.css` | Counter screen, pop-up cards, lock mode |
| `css/settings.css` | Settings screen, round header buttons, sync indicator |
| `css/projects.css` | Projects list, cards, tour, project form and page, photo viewer, Home hero, now-knitting bar |
| `js/app.js` | Start-up: tab bar, routes, service worker, sync, now-knitting bar |
| `js/router.js` | Hash routing (`#/home`, `#/stash`, `#/projects`, `#/project/<id>`, `#/project-new[/<draftId>]`, `#/project-edit/<id>`, `#/patterns`, `#/activity`, `#/counter[/<projectId>]`, `#/settings`) |
| `js/version.js` | `APP_VERSION`, shown in Settings (always equal to `VERSION` in `sw.js`) |
| `js/sync/config.js` | Supabase URL and publishable key (empty = local only) |
| `js/sync/auth.js` | Email + password sign-in, sign-up, password reset, token refresh, sign-out (fetch only) |
| `js/sync/engine.js` | Push / pull with `ld_records`, triggers, back-off, status in plain words |
| `js/sync/files.js` | Photo bytes to and from Supabase Storage (upload, thumbnail download, delete) |
| `supabase/setup.sql` | The server table, trigger and security rules (run once in Supabase) |
| `supabase/storage.sql` | The private `ld-files` photo bucket and its rules (run once in Supabase) |
| `js/db.js` | Tiny IndexedDB wrapper: stamping, soft delete, dirty flag, settings, device-only stores |
| `js/data/projects.js` | Projects: statuses, crafts, progress, "worked on", delete; the built-in "Quick counter" |
| `js/data/counters.js` | Counter model: taps, undo history, extra counters, row notes |
| `js/data/timer.js` | Knitting sessions and timer logic, timer settings, time worked per project |
| `js/data/photos.js` | Shrink photos on the device, save, thumbnails, cover, delete |
| `js/ui/*.js` | DOM helpers, line icons, illustrations + progress ring, sheets/dialogs/toast, wave header, sync badge, photo picker + viewer, now-knitting bar |
| `js/screens/home.js` | Home: greeting, "continue" card, Quick tools |
| `js/screens/projects.js` | Projects tab: search, filter, sort, drafts, cards |
| `js/screens/tour.js` | First-time Projects tour |
| `js/screens/project.js` | Project page |
| `js/screens/project-form.js` | New / edit project form (keeps drafts) |
| `js/screens/placeholder.js` | "Arriving soon" pages for Stash, Patterns, Activity |
| `js/screens/counter.js` | The row counter screen |
| `js/screens/counter-sheets.js` | Goal dialog, row notes sheet, extra counter sheet |
| `js/screens/lock.js` | Lock mode (whole screen = +1, hold to unlock, wake lock) |
| `js/screens/timer-settings.js` | Timer & breaks sheet |
| `js/screens/settings.js` | Settings: your account, sync, offline copy, about |
| `fonts/` | Nunito and Fredoka (self-hosted, SIL OFL 1.1, see `fonts/OFL.txt`) |
| `icons/` | App icon (`icon.svg` source, 180/192/512 PNGs) |

A new screen is a module exporting `mount(container, params)` (returning a cleanup
function) and, if it hides the tab bar, `fullscreen = true`. Register it in `js/app.js`.

## Data model (IndexedDB database `loopy-days`)

Every record has `id` (`crypto.randomUUID()`), `created_at`, `updated_at` (ISO strings),
`deleted` (boolean, soft delete) and `dirty` (`1` = changed here and not yet synced,
`0` = synced). Every store has `dirty` and `updated_at` indexes.

| Store | Fields |
| --- | --- |
| `projects` | `name`, `kind` (`quick` / `project`), `craft` (`knitting` / `crochet` / `other`), `status` (`not_started` / `in_progress` / `on_hold` / `finished` / `frogged`; unknown old values read as not started), `start_date` / `finished_date` (local `YYYY-MM-DD`), `cover_photo_id`, `pattern_id` (null until feature 6), `notes`, `last_worked_at`, `sort`, `draft` (+ `draft_target` while a draft) |
| `counters` | `project_id`, `name`, `value`, `target`, `is_main`, `step`, `big_step`, `reset_with_main`, `sort`, `last_tapped_at`, `goal_reached_at` |
| `counter_events` | `project_id`, `counter_id`, `delta`, `value_after`, `kind` (`tap` / `reset` / `auto-reset`), `group_id` (one user action), `at`, `undone` |
| `row_notes` | `project_id`, `counter_id`, `row`, `text`, `done` |
| `sessions` | `project_id`, `started_at`, `ended_at`, `active_ms`, `paused_ms`, `rows`, `status` (`running` / `paused` / `ended`), live fields `seg_start`, `paused_at`, `last_activity`, `pause_reason`, `break_base_ms`, `end_reason` |
| `settings` | `key`, `value` (e.g. `quick_project_id`, `timer`, `projects_tour_seen`) |
| `photos` | `project_id`, `mime`, `width`, `height`, `taken_at`, `sort` (metadata only; synced like the rest) |
| `files` | **This device only, never in `ld_records`.** Same `id` as the photo: `project_id`, `kind` (`photo`), `mime`, `width`, `height`, `blob` (full, longest side 1600 px, JPEG 0.8), `thumb` (400 px), `uploaded`, `thumb_uploaded`, `storage_path`, `remote_gone`, timestamps, `deleted`, `dirty` |

**Goal / target rows** live on the project's main counter (`counters.target`), one place only.
**Progress** = main counter value / target when there is a target; Finished = 100 %; otherwise 0 %.
**Coming later:** `project_yarn` (project_id, yarn_id, amount) and `project_tools`
(project_id, tool_id) stores for Stash (feature 5); `pattern_id` on projects for Patterns (feature 6).
Add them as new stores in a new migration; they sync automatically.

Settings rows are read by `key`; if two devices each made a row for the same key, the
newest one counts (`db.getSetting`), and `db.setSetting` writes to that row.
`updated_at` always moves forward by at least 1 ms per change, so no two versions of a
record share a timestamp. Schema changes go in the `MIGRATIONS` list in `js/db.js`
(append only); a new store syncs automatically, and a schema change makes each device
pull everything once more.

Things that belong to one device only are kept in `localStorage`, never in a synced
store: `ld-auth` (sign-in tokens), sessionStorage `ld-auth-recovery` (one-time reset session),
`ld-sync` (`last_seq`, user id, last success).

Each tap updates the number on screen first, then writes the counter and its event in a
single IndexedDB transaction, so the count survives closing the app, killing Safari and
having no signal.

## Sync (feature 2)

Sync only runs when `js/sync/config.js` is filled in **and** someone is signed in. With
the config empty the app is exactly local-only, makes no network calls besides its own
files, and Settings says sync isn't set up yet. There is no Supabase library: everything
goes through `fetch()`.

- **Sign-in:** email + **password** (`POST /auth/v1/token?grant_type=password`; first time
  `POST /auth/v1/signup`, which needs "Confirm email" turned off). "Forgot password?" calls
  `POST /auth/v1/recover`; the email link opens the app in Safari, `catchRecoveryLink()` keeps
  its one-time session and Settings asks for a new password (`PUT /auth/v1/user`). Tokens
  refresh a minute before they expire and after a `401`. Sign out calls `/auth/v1/logout` and
  forgets the tokens; local data stays.
- **Push:** dirty records of every store, in batches of 200, to
  `POST /rest/v1/ld_records?on_conflict=id` (`Prefer: resolution=merge-duplicates,return=minimal`).
  Rows: `{ id, store, data (record without dirty), updated_at, deleted }`. A record is marked
  clean only if it hasn't changed since it was read, so a tap made during a push is never lost.
- **Pull:** `GET /rest/v1/ld_records?...&server_seq=gt.<last_seq>&order=server_seq.asc&limit=1000`
  until a page has fewer than 1000 rows. A server row is written locally (with `dirty = 0`
  and its own timestamps) when there is no local copy, the local copy isn't waiting to be
  sent, or the server copy is newer. After real changes the window gets `ld:data-changed`
  (`detail.stores`); Home and the counter re-read. The counter waits until 2 s after the
  last tap (and until open sheets are closed) so numbers never change under your thumb.
- **When:** at start, when the connection comes back, when the app becomes visible,
  3 s after any change, every 60 s while open, and on "Sync now". Errors are quiet
  (status line only) and retried after 5 s, 15 s, 30 s, 1 min, 2 min, then every 5 min.
- **Order:** push first, then pull, so a device used before signing in (or offline)
  uploads its data.
- **Quick counter on two devices:** both projects are kept; `quick_project_id` follows the
  one whose counter was actually used most recently (an untouched, empty one never wins),
  so every device lands on the same counter.
- **Last change wins per record.** If the same counter is changed on two devices before
  they sync, the later change is kept.

### Photos (feature 3)

Photos are shrunk on the device (longest side 1600 px, JPEG quality 0.8, the photo's own
orientation kept; thumbnails 400 px) and saved in the device-only `files` store, so they
show at once, even offline. Their metadata syncs through `ld_records` (store `photos`); the
bytes go through Supabase Storage, bucket `ld-files` (private):
`<user_id>/photos/<photo_id>.jpg` and `<user_id>/photos/<photo_id>_thumb.jpg`.

After each record sync the file queue runs: upload photos not yet uploaded
(`POST /storage/v1/object/ld-files/<path>`, `x-upsert: true`), delete the online copies of
deleted photos (`DELETE ...`), and fetch missing thumbnails
(`GET /storage/v1/object/authenticated/ld-files/<path>`). Full images are fetched the first
time they're opened, then kept. Storage problems (bucket not made yet, a photo the other
device hasn't uploaded yet) are quiet, never stop the record sync, and are retried after
2 minutes. New pictures fire `ld:files-changed` so Home and project screens repaint.

### Setting up Supabase (one time)

1. Create a Supabase project. In **SQL Editor**, run `supabase/setup.sql` exactly as it is,
   then `supabase/storage.sql` (the private photo bucket `ld-files` and its rules).
2. In **Authentication -> Sign In / Providers -> Email**, keep Email enabled and turn
   **Confirm email** off. In **URL Configuration**, set Site URL and add a Redirect URL to the
   app's address (used by the password-reset email).
3. Sign in once on your iPhone so your account exists. Then turn off **Allow new users to
   sign up** so the app stays private; anyone else sees "This Loopy Days is private".
4. In **Project Settings -> API** copy the Project URL and the publishable (anon) key
   into `js/sync/config.js`. Never put the service-role key or any other secret in the code.
5. Raise `VERSION` in `sw.js` and `APP_VERSION` in `js/version.js`, then publish.
6. First device: Home -> gear -> Your account -> email + new password -> Create my account.
   Other devices: same, then Sign in.

## Notes

- iPhone Safari has no vibration API, so nothing relies on it.
- Screen Wake Lock (lock mode) works in iOS 16.4+ home-screen apps; elsewhere it is skipped.
- Projects: the first visit to the tab shows a short tour (the ? button reopens it). A new
  project form is kept as a draft as soon as something is typed ("Continue setting up").
  Counting on a "Not started" project switches it to "In progress" and sets the start date.
  The built-in Quick counter is a Home tool and never appears in the Projects list.
- The now-knitting bar (above the tab bar) applies the timer's auto-pause and 4-hour rules
  itself, so a forgotten session doesn't keep ticking.
