#!/bin/bash
# ============================================================
#  IntExeBook – macOS launcher (double-click this file)
#
#  Starts the local server and opens the app in your browser.
#  Uses Python from https://www.python.org/downloads/macos/
#  (or any python3 already on your Mac). No admin rights needed.
# ============================================================

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${IEB_PORT:-8000}"

log() { printf '\033[1;36m[IntExeBook]\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31m[IntExeBook]\033[0m %s\n' "$1"; read -r -p "Press Enter to close…" _; exit 1; }

# ------------------------------------------------------------ find python3
PY=""
for c in /usr/local/bin/python3 /opt/homebrew/bin/python3 python3; do
  if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  # Apple's Command Line Tools stub would pop up an installer dialog – avoid it
  if /usr/bin/python3 -c '' >/dev/null 2>&1; then
    PY=/usr/bin/python3
  fi
fi
if [ -z "$PY" ]; then
  log "Python 3 not found. Opening the download page…"
  open "https://www.python.org/downloads/macos/"
  fail "Install Python for macOS from python.org, then double-click this file again."
fi

log "Using interpreter: $($PY --version 2>&1)"

# ------------------------------------------------------------ free the port?
if (nc -z 127.0.0.1 "$PORT" 2>/dev/null || lsof -nP -iTCP:"$PORT" -sTCP:LISTEN) >/dev/null 2>&1; then
  # something is already listening – maybe the app itself
  if curl -s "http://127.0.0.1:$PORT/api/ping" | grep -q '"ok"'; then
    log "IntExeBook is already running – just opening it."
    open "http://127.0.0.1:$PORT"
    exit 0
  fi
  PORT=$((PORT + 1))
  log "Port busy, using $PORT instead."
fi

# ------------------------------------------------------------ start server
cd "$APP_DIR" || fail "Cannot enter app folder: $APP_DIR"
nohup "$PY" server/app.py --port "$PORT" >/tmp/intexebook.log 2>&1 &
SERVER_PID=$!

# wait until it answers (max ~5 s)
for i in $(seq 1 25); do
  sleep 0.2
  if curl -s "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    cat /tmp/intexebook.log
    fail "Server exited. See /tmp/intexebook.log for details."
  fi
done

URL="http://127.0.0.1:$PORT"
log "Running at $URL  (server PID $SERVER_PID, log: /tmp/intexebook.log)"
open "$URL"

echo
echo "  IntExeBook is open in your browser."
echo "  Keep THIS Terminal window open while you work with the app."
echo "  Close this window (or press Ctrl+C) to stop the server."
echo

cleanup() { kill "$SERVER_PID" 2>/dev/null; }
trap cleanup EXIT INT TERM
wait "$SERVER_PID"
