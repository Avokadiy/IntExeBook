# Changelog

All notable changes to IntExeBook are documented here. The app's in-app
update dialog reads its change list from `app_version.json`
(`changelogVersions`) — keep both files in sync when releasing.

## [1.0.3] — 2026-10-26

### Fixed
- **True/False tasks now unlock the Next button on selection.** Picking
  TRUE or FALSE in `true-false` and `reading-truefalse` tasks previously left
  "Next →" disabled until Check was pressed; the engines (`engineTF`,
  `engineReadingTF`) now mark progress as soon as an answer is selected, so a
  student can move on immediately after choosing.
- **Halloween course: missing pictures/icons.** The `click-on-picture` task
  shipped with an empty `image` field, which rendered a broken/blank picture.
  - `enginePicture()` now generates a themed Halloween SVG scene (with the
    hotspot labels placed at their declared coordinates) whenever a task has
    no usable image file, and swaps it in via `onerror` if a referenced file
    fails to load.
  - `anyMedia("image")` also recognises a task's direct `image` property, so
    engines that render media (short-answer, video-quiz, …) show the picture.
  - `listen-choice` without an attached audio clip now speaks the answer
    options aloud (🔊 Read the options aloud) instead of only repeating the
    instruction.

### Changed
- App version bumped to **1.0.3** (`package.json`, `app_version.json`,
  `web/index.html` — including the bottom-left badge).

## [1.0.2] — 2026-10-26

### Fixed
- **Course editor no longer breaks.** Creating a new course (`#/create`)
  showed a blank screen, and opening an existing textbook for editing crashed
  with `Could not open this textbook for editing: Failed to execute
  'appendChild' on 'Node': parameter 1 is not of type 'Node'`.
  - The DOM helper `h()` now silently skips `null`/`undefined`/boolean
    children instead of feeding them to `appendChild()`.
  - The bridge to the main app (`window.IEB_APP`) is resolved lazily through
    a proxy with DOM fallbacks, so a half-initialised or missing bridge can no
    longer render the editor into `undefined` (the blank-screen cause).
  - Every async editor entry point (`renderCreate`, `renderImport`,
    `renderImportZip`, …) now catches its own errors and paints a readable
    error box with a "← back to Textbooks" link, instead of leaving the user
    on a silent empty page.

### Changed
- App version bumped to **1.0.2** (`package.json`, `package-lock.json`,
  `app_version.json`, `web/index.html` — including the bottom-left badge).

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
