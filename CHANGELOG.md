# Changelog

All notable changes to IntExeBook are documented here. The app's in-app
update dialog reads its change list from `app_version.json`
(`changelogVersions`) — keep both files in sync when releasing.

## [1.0.1] — 2026-10-26

### Added
- **Blinking red update beacon** next to the "🔄 Update" button in the top bar.
  It appears as soon as the repository (`shared-exercises/` on the `shared-hub`
  branch) contains **new or changed courses** that this machine has not synced
  yet, and goes dark after a successful pull/publish. Hovering the lamp shows
  which courses are waiting.
  - Detection is cheap and API-friendly: one GitHub Contents listing per check;
    each pack file's git blob sha is compared against the sha recorded as
    "seen" at the last install/publish (`ieb-sync-seen` in localStorage).
  - Results are cached for 5 minutes; checks run at startup, every 10 minutes,
    on tab focus, and right after every sync. Network/auth failures leave the
    lamp dark — it never nags or lies.
  - Respects `prefers-reduced-motion` (slower, gentler blink).
  - Regression tests for the beacon logic live in `tools/test_sync_pull.js`.

### Changed
- App version bumped to **1.0.1** (`package.json`, `app_version.json`,
  `web/index.html`).

## [1.0.0] — 2026-10-26

Initial public release of IntExeBook:
- Authoring studio with 30 exercise types (audio, video, text, drag & drop,
  matching, quizzes and more).
- Course hub: publish, edit and delete courses from the `shared-hub` git
  branch; one-click "🔄 Update" syncs every teacher's library (deletions
  propagate too).
- Admin panel behind the Konami code for managing hub courses.
- One-click in-app self-update: a dialog with the changes list and an
  "Update now" button when a newer release exists in the hub.
- The update button is only visible while a newer release actually exists.
