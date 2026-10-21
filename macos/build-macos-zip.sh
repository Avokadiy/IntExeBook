#!/bin/bash
# ============================================================
#  Builds the distributable archive for macOS:
#     dist/IntExeBook-macOS.zip
#
#  The zip unpacks into a self-contained folder:
#     IntExeBook/
#       ├── IntExeBook.app   (double-click launcher, opens in browser)
#       ├── IntExeBook.command
#       ├── server/ web/ textbooks/ shared-exercises/ tools/
#       └── README.txt
#
#  Run from the repo root:  bash macos/build-macos-zip.sh
# ============================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
VER="$(python3 -c "import json;print(json.load(open('$REPO/package.json'))['version'])" 2>/dev/null || echo 1.0.0)"
DIST="$REPO/dist"
STAGE="$DIST/IntExeBook"
APP="$STAGE/IntExeBook.app"

echo "[build] version $VER"
rm -rf "$STAGE" "$DIST/IntExeBook-macOS.zip"
mkdir -p "$APP/Contents/MacOS"

# ------------------------------------------------------------ app bundle
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>IntExeBook</string>
  <key>CFBundleDisplayName</key><string>IntExeBook</string>
  <key>CFBundleIdentifier</key><string>com.intexebook.app</string>
  <key>CFBundleVersion</key><string>$VER</string>
  <key>CFBundleShortVersionString</key><string>$VER</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>IntExeBook</string>
  <key>LSMinimumSystemVersion</key><string>10.13</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

printf 'APPL????' > "$APP/Contents/PkgInfo"

cat > "$APP/Contents/MacOS/IntExeBook" <<'SH'
#!/bin/bash
# The real app folder is one level above the .app bundle.
DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
exec "$DIR/IntExeBook.command"
SH
chmod +x "$APP/Contents/MacOS/IntExeBook"

cp "$REPO/macos/IntExeBook.command" "$STAGE/IntExeBook.command"
chmod +x "$STAGE/IntExeBook.command"

# ------------------------------------------------------------ app payload
copy() {
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --exclude '__pycache__' --exclude '.DS_Store' "$REPO/$1" "$STAGE/"
  else
    mkdir -p "$STAGE/$1"
    (cd "$REPO" && tar cf - --exclude='__pycache__' --exclude='.DS_Store' "$1") | (cd "$STAGE" && tar xf -)
  fi
}
copy server
copy web
copy textbooks
copy shared-exercises
copy tools
cp "$REPO/launcher.js" "$REPO/package.json" "$STAGE/"
[ -f "$REPO/README.md" ] && cp "$REPO/README.md" "$STAGE/"

cat > "$STAGE/README.txt" <<TXT
IntExeBook $VER for macOS
=========================

How to start:
  1. Unzip this archive anywhere (Desktop / Applications is fine).
  2. Double-click "IntExeBook.app" (or "IntExeBook.command").
  3. The app opens in your default browser. Keep the terminal
     window open while working; close it to quit.

First launch note (Gatekeeper):
  If macOS says the app cannot be opened, right-click the app ->
  Open -> Open. Or run once in Terminal:
      xattr -dr com.apple.quarantine "IntExeBook"

Requirements:
  Python 3 (https://www.python.org/downloads/macos/). Nothing else.

Data:
  Your courses live in "textbooks/" (drop folders or .zip there),
  shared hub courses in "shared-exercises/".
TXT

# ------------------------------------------------------------ zip
if command -v ditto >/dev/null 2>&1; then
  ditto -c -k --sequesterRsrc "$STAGE" "$DIST/IntExeBook-macOS.zip"
elif command -v zip >/dev/null 2>&1; then
  (cd "$DIST" && zip -qry IntExeBook-macOS.zip IntExeBook)
else
  python3 - "$STAGE" "$DIST/IntExeBook-macOS.zip" <<PY
import os, sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in ("__pycache__", ".DS_Store")]
        for f in files:
            fp = os.path.join(root, f)
            z.write(fp, os.path.relpath(fp, os.path.dirname(src)))
PY
fi
echo "[build] done -> $DIST/IntExeBook-macOS.zip ($(du -h "$DIST/IntExeBook-macOS.zip" | cut -f1))"
