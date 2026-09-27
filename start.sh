#!/usr/bin/env bash
# IntExeBook launcher for macOS / Linux
cd "$(dirname "$0")" || exit 1

PY=python3
command -v python3 >/dev/null 2>&1 || PY=python

if ! $PY -c 'import sys; sys.exit(0 if sys.version_info>=(3,8) else 1)' 2>/dev/null; then
  echo "Python 3.8+ is required (https://www.python.org/downloads/)"; exit 1
fi

( sleep 1; open "http://localhost:8000" 2>/dev/null || xdg-open "http://localhost:8000" 2>/dev/null ) &
exec $PY server/app.py --port 8000
