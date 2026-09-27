# NubePlayer architecture

NubePlayer streams a personal OneDrive music library. It is one web app, written
in plain JavaScript (ES modules, no build step), that runs both as a website/PWA
and inside an Android wrapper (Capacitor). Everything happens on the device:
there is no server of our own.

```
index.html ──loads──▶ js/main.js ──imports──▶ every feature
```

## Layers

Code lives in folders, and a module may only import from the layers **below** it.
`tests/architecture.test.js` enforces this, and forbids import cycles.

| Layer | May import | What lives here |
|---|---|---|
| `js/core/` | core | Platform check, event emitter, config, error log, DOM element table, small text helpers, "is playback intended" |
| `js/data/` | core, data | Talking to the outside world and owning data: Microsoft sign-in, Graph (OneDrive), the library index, the artist reader, playlists, tag reading, lyrics / cover-art lookups |
| `js/state/` | core, state | What the folder view is showing (`browse.js`) |
| `js/player/` | core, data, player | The playback engine: queue, shuffle/repeat, media session, resume-after-restart |
| `js/ui/` | everything below | Screens and their wiring: one module per feature |
| `js/main.js` | everything | Entry point: sign-in check, showing the app or the login screen |

Rules of thumb:

- **One owner per piece of state.** Only the owning module assigns to its variables
  (the language enforces it: imported bindings are read-only). Other modules ask
  through functions, e.g. `markLibraryStale()`, `goUpOneFolder()`, `currentTrack()`.
- **Features don't import each other sideways when they can avoid it.** A module that
  owns something others react to exposes an emitter (`libraryEvents` in
  `ui/libraryWork.js`) instead of importing its listeners.
- **Screens contain no lookup logic.** Matching, scoring and network lookups live in
  `data/` (`textMatch`, `lyrics`, `artwork`) where they can be tested without a DOM.
- Every module starts with a comment saying what it is for.

## How the pieces fit

- **Library, two tiers.** `data/library.js` scans OneDrive folders for song file names
  (fast). `data/indexer.js` then reads each song's embedded artist tag in the
  background (`data/id3.js` reads only the tag header; `data/indexKeepAlive.js` and the
  Android foreground service keep it running with the screen off). Search is
  in-memory over both.
- **PC shortcut.** `tools/scan-artists.js` reads artists from a local copy of the music
  folder and writes `nubeplayer-artists.json` into it; OneDrive syncs it and
  `data/library.js` (`syncArtistsFile`) fills in almost every artist from that one file.
  The in-app reader remains the fallback. `tools/install-artists-task.ps1` schedules it.
- **Playback.** `player/player.js` owns the audio element and the queue and reports
  changes through callbacks (`player.onTrackChange`, ...), which `ui/playerUI.js`
  sets. Playback state is saved so the app resumes where it stopped.
- **Storage.** Everything is in `localStorage` (library index, playlists, settings,
  last playback state, error log). Playlists live on the device only.
- **Offline shell.** `sw.js` caches the app shell (the list of files is kept current
  by `tools/update-sw-list.js`).

## Working on it

```
node tests/run-all.js            all automated checks (no phone or browser needed)
node tests/phone-smoke.js        UI + back-button checks on a USB-connected phone
node tests/phone-smoke.js --deep   ...plus playing a song and rebuilding the library

cd tools && npm install          once: dev tools (jsdom, acorn, eslint-scope, music-metadata)
node tools/organize-imports.js --write   after moving code between modules
node tools/update-sw-list.js --write     after adding or removing a module
```

What the tests cover:

- `architecture` layers and cycles · `modules` real import/export wiring, every name
  resolves, no unused exports · `boot` every module reachable, in the service-worker list
- `ui`, `ui-flows`, `ui-onboarding` the real app running in jsdom with a fake OneDrive:
  browsing, search, playback, lyrics view, playlists, backup/restore, first-run setup,
  the Android back button
- `library-*`, `indexer-*`, `artists-file` library search, indexing pace and retries,
  the artists-file shortcut · `matching` lyrics and cover-art lookup · `pc-tool` the PC program

Things to know:

- **Top-level names are unique across modules.** The sandboxed tests load modules as
  one script (`tests/helpers/flatten.js`), and `organize-imports` relies on it.
- **Shipping a change:** bump `APP_VERSION` in `js/core/config.js` and `CACHE_NAME` in
  `sw.js` together, then for Android `cd android-app && npm run sync`, `gradlew
  assembleDebug`, `adb install -r`.
- **The Android app is the same code.** `android-app/sync-web.mjs` copies `index.html`,
  `css/`, `js/` and friends into the wrapper; native pieces (media session, the
  indexing foreground service) are under `android-app/android/`.
- `js/vendor/` holds the vendored Capacitor plugin scripts (plain scripts, not modules).

## Not done yet (deliberately)

- `player/player.js` is still the largest module (about 800 lines). Its state is
  tightly interwoven (queue, prefetch, network recovery); splitting it should be done
  with a phone at hand to check playback on the device.
- The library index is stored in `localStorage` (about 1 MB, rewritten in one piece).
  IndexedDB would suit it better, but it makes reads asynchronous, so it is a separate,
  behaviour-changing step, worth doing only if the size or speed becomes a problem.
