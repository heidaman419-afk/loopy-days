# Loopy Days

A private iPhone home-screen web app (PWA) for knitters. This version holds
**feature 1, the row counter**, plus the app shell that later features slot into.

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

**After changing any file, raise `VERSION` in `sw.js`** (for example `loopy-days-v2`) and
add any new file to its `FILES` list, so installed copies pick up the update.

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
| `js/app.js` | Start-up: tab bar, routes, service worker |
| `js/router.js` | Hash routing (`#/home`, `#/stash`, `#/projects`, `#/patterns`, `#/activity`, `#/counter[/<projectId>]`) |
| `js/db.js` | Tiny IndexedDB wrapper: stamping, soft delete, dirty flag, settings |
| `js/data/projects.js` | Projects; creates the built-in "Quick counter" project |
| `js/data/counters.js` | Counter model: taps, undo history, extra counters, row notes |
| `js/data/timer.js` | Knitting sessions and timer logic, timer settings |
| `js/ui/*.js` | DOM helpers, hand-drawn SVG icons, sheets/dialogs/toast, wave header |
| `js/screens/home.js` | Home: greeting and Quick tools |
| `js/screens/placeholder.js` | "Arriving soon" pages for Stash, Projects, Patterns, Activity |
| `js/screens/counter.js` | The row counter screen |
| `js/screens/counter-sheets.js` | Goal dialog, row notes sheet, extra counter sheet |
| `js/screens/lock.js` | Lock mode (whole screen = +1, hold to unlock, wake lock) |
| `js/screens/timer-settings.js` | Timer & breaks sheet |
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
| `projects` | `name`, `kind` (`quick` / `project`), `status`, `craft`, `notes` |
| `counters` | `project_id`, `name`, `value`, `target`, `is_main`, `step`, `big_step`, `reset_with_main`, `sort`, `last_tapped_at`, `goal_reached_at` |
| `counter_events` | `project_id`, `counter_id`, `delta`, `value_after`, `kind` (`tap` / `reset` / `auto-reset`), `group_id` (one user action), `at`, `undone` |
| `row_notes` | `project_id`, `counter_id`, `row`, `text`, `done` |
| `sessions` | `project_id`, `started_at`, `ended_at`, `active_ms`, `paused_ms`, `rows`, `status` (`running` / `paused` / `ended`), live fields `seg_start`, `paused_at`, `last_activity`, `pause_reason`, `break_base_ms`, `end_reason` |
| `settings` | `key`, `value` (e.g. `quick_project_id`, `timer`) |

**For the later sync module:** read `db.dirtyRecords(store)` for each store, push them
(soft-deleted rows included), then call `db.markClean(store, ids)`. When pulling,
keep the record with the newer `updated_at`. Schema changes go in the `MIGRATIONS`
list in `js/db.js` (append only).

Each tap updates the number on screen first, then writes the counter and its event in a
single IndexedDB transaction, so the count survives closing the app, killing Safari and
having no signal.

## Notes

- iPhone Safari has no vibration API, so nothing relies on it.
- Screen Wake Lock (lock mode) works in iOS 16.4+ home-screen apps; elsewhere it is skipped.
