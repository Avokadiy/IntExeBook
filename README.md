# 📖 IntExeBook

Interactive tasks for English teachers — runs 100% locally, no internet needed.

**No Python required.** The app now ships as a self-contained desktop program,
plus several zero-knowledge launch options (see below).

## How a teacher starts it (pick ONE)

| Option | What you do | Requires installed? |
|---|---|---|
| **A. Portable EXE (Windows)** | Double-click `IntExeBook-1.0.0.exe` (in `release/` after build, or shared via USB/cloud). A window opens. Done. | nothing |
| **B. `start.bat` / `start.sh`** | Double-click the launcher file next to this README. It automatically picks the best engine available: packaged app → Electron → Python server → plain browser mode. | nothing |
| **C. Browser only** | Open `web/index.html` in Chrome/Edge/Firefox. Works without any server if your browser allows local file access; otherwise the page explains what to do. | nothing |

### Building the portable EXE yourself (developer machine, needs Node.js)
```bash
npm install          # once, downloads Electron
npm run dist         # produces release/IntExeBook-<version>.exe (single file)
npm start            # run the desktop app directly from source
```
The `.exe` is one standalone file (~270 MB) that can be copied to any Windows PC.
macOS (`dmg`) and Linux (`AppImage`) builds: `npx electron-builder --mac` / `--linux`.

## Teacher flow
1. **Choose a textbook** (cards are generated from the `textbooks/` folder)
2. **Student's Book** or **Workbook**
3. **Unit → Lesson**
4. **Task** → interactive player with instant checking, progress dots and a score screen.

Supported task types: `multiple-choice`, `true-false`, `gap-fill`, `word-order`, `matching`.

## Modular textbooks
Add a new textbook by copying its **folder** or a **`.zip` / `.tar.gz` archive** into:
* unpacked/source version → `textbooks/`
* installed EXE version → `%APPDATA%\IntExeBook\textbooks` (a `_HOW-TO-ADD-TEXTBOOKS.txt` file sits there), then restart the app. Archives are unpacked automatically.

Each package contains:
```
my-book/
  manifest.json     id, title, subtitle, level, description, color, icon,
                    "student": "Student's Book", "workbook": "Workbook"
  student.json      { "units": [ { "id","title","lessons":[ { "id","title","page","tasks":[...] } ] } ] }
  workbook.json     same schema
  assets/           optional images/audio (served at /assets/<book>/...)
```
Copy `textbooks/_TEMPLATE/` and edit — full format reference inside.
Folders starting with `_` are ignored. Broken packages show a warning card instead of crashing the app.

## Architecture
```
desktop/server-core.js  pure-Node backend (used by the EXE): scans textbooks, serves API + UI
desktop/main.js         Electron shell: window, writable user textbooks dir, first-run seeding
server/app.py, loader.py  equivalent Python backend (optional lightweight mode, stdlib only)
web/                    single-page UI (vanilla JS) shared by all modes; also works from file://
textbooks/              modular content packs (2 demo courses included)
start.bat / start.sh    smart launchers with automatic engine fallback
```

## Development
```bash
python server/app.py --port 8000   # classic server mode (if you like Python)
npm start                          # Electron dev mode
node -e "require('./desktop/server-core.js').start(8000)"  # bare Node server, no Electron
```
