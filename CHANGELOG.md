# Changelog

All notable changes to IntExeBook are documented in this file.
Versions follow the release badge shown next to the app (`vX.Y.Z`).

## [1.0.1] — 2026-10-26

### Added
- **Blinking red "new courses" beacon next to the 🔄 Update button.** A small
  red light now pulses on the corner of the update button whenever the
  `shared-exercises/` folder in the GitHub repository contains a course that
  is new or has changed since the last sync/publish performed on this machine
  (web/index.html, web/style.css, web/app.js).
  - Detection lives in `web/shared.js` → `checkForNewCourses()`: one cheap
    GitHub Contents-API listing per check; each pack file's git SHA is
    compared against the SHA recorded when that exact revision was last
    installed (`syncPull`) or published (`syncPushPack`). Unknown file or
    changed SHA ⇒ pending update ⇒ light blinks.
  - The result is cached for 5 minutes; checks run at startup, every 10
    minutes, on tab re-focus and immediately after a sync finishes, so the
    light goes quiet as soon as everything is downloaded.
  - Hovering the light shows which courses are waiting; network/auth hiccups
    keep the last known state instead of flickering the light off.
  - Accessibility: respects `prefers-reduced-motion` (solid light, no pulse).
- Regression tests for the beacon in `tools/test_sync_pull.js`
  (pending ⇒ mark seen ⇒ re-light on sha change; pull silences the beacon).

### Changed
- App version bumped to **1.0.1** (`package.json`, README).

## [1.0.0]

### Fixed
- Sync never reports courses as "updated" when `shared-exercises/` is empty
  (false-success bug); counts only reflect real installs.
- Zero-duplicate guarantee: already-pulled revisions are skipped by content
  digest, even across client/server hash mismatches and app restarts.

### Added
- One-button GitHub sync ("🔄 Update"): publish/pull shared courses with a
  fine-grained PAT, smart install/update/merge/duplicate decisions.
- Portable desktop app (Electron + electron-builder), Python and browser-only
  fallback modes, modular textbook packs, authoring editor with 10 task types.
