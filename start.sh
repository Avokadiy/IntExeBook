#!/usr/bin/env bash
# IntExeBook launcher for macOS / Linux - double-click or run ./start.sh
cd "$(dirname "$0")" || exit 1

# 1) Electron desktop app, if available
if [ -x node_modules/electron/dist/electron ]; then
  exec node_modules/electron/dist/electron .
fi

# 2) Python server, if Python >= 3.8 is installed
PY=python3
command -v python3 >/dev/null 2>&1 || PY=python
if $PY -c 'import sys; sys.exit(0 if sys.version_info>=(3,8) else 1)' 2>/dev/null; then
  ( sleep 1; xdg-open "http://localhost:8000" 2>/dev/null || open "http://localhost:8000" 2>/dev/null ) &
  exec $PY server/app.py --port 8000
fi

# 3) fallback: open the plain files in the default browser
xdg-open "web/index.html" 2>/dev/null || open "web/index.html"
