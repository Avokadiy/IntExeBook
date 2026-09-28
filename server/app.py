#!/usr/bin/env python3
"""
IntExeBook – local web app for teachers.

Run:  python server/app.py  [--port 8000]
Then open http://127.0.0.1:8000

No third-party dependencies required (Python 3.8+ standard library only).
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loader  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(ROOT, "web")

mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("audio/mpeg", ".mp3")
mimetypes.add_type("audio/wav", ".wav")
mimetypes.add_type("audio/ogg", ".ogg")
mimetypes.add_type("video/mp4", ".mp4")
mimetypes.add_type("video/webm", ".webm")


class Handler(BaseHTTPRequestHandler):
    server_version = "IntExeBook/1.0"

    # ------------------------------------------------------------------ util
    def _send_json(self, obj, status: int = 200) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: str) -> None:
        if not os.path.isfile(path):
            self._send_json({"error": "Not found"}, 404)
            return
        ctype, _ = mimetypes.guess_type(path)
        with open(path, "rb") as fh:
            body = fh.read()
        # support HTTP Range requests so <video>/<audio> seeking works
        headers = [("Content-Type", ctype or "application/octet-stream"),
                   ("Content-Length", str(len(body))),
                   ("Cache-Control", "no-cache"),
                   ("Accept-Ranges", "bytes")]
        status = 200
        rng = self.headers.get("Range")
        if rng and rng.startswith("bytes="):
            try:
                start_s, _, end_s = rng[6:].partition("-")
                start = int(start_s) if start_s else 0
                end = int(end_s) if end_s else len(body) - 1
                end = min(end, len(body) - 1)
                if start <= end:
                    body = body[start:end + 1]
                    status = 206
                    headers = [("Content-Type", ctype or "application/octet-stream"),
                               ("Content-Length", str(len(body))),
                               ("Content-Range", "bytes %d-%d/%d" % (start, end, os.path.getsize(path))),
                               ("Accept-Ranges", "bytes")]
            except ValueError:
                pass
        self.send_response(status)
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _send_asset(self, tb_id: str, rel_parts) -> None:
        """Serve <textbook>/assets/<file>, transparently extracting the file
        from a sibling archive when the folder was never unpacked (a broken
        or not-yet-scanned .zip must not disable audio/video playback)."""
        try:
            folder, _manifest = loader.get_textbook_meta(tb_id)
        except loader.TextbookError:
            folder = os.path.join(loader.TEXTBOOKS_DIR, tb_id)
        rel = "/".join(rel_parts)
        full = loader.asset_path(folder, rel)
        if not os.path.isfile(full):
            stem = os.path.join(loader.TEXTBOOKS_DIR, tb_id)
            for ext in (".zip", ".tar.gz", ".tgz", ".tar"):
                arc = stem + ext
                if not os.path.exists(arc):
                    continue
                try:
                    if loader.extract_asset_from_archive(arc, rel, folder):
                        break
                except Exception:
                    continue
        return self._send_file(full)

    # --------------------------------------------------------------- routing
    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        try:
            if path in ("/", "/index.html"):
                return self._send_file(os.path.join(WEB_DIR, "index.html"))
            if path.startswith("/static/"):
                rel = os.path.normpath(path[len("/static/"):])
                if rel.startswith("..") or os.path.isabs(rel):
                    return self._send_json({"error": "Bad request"}, 400)
                return self._send_file(os.path.join(WEB_DIR, rel))

            # also serve web/ files by plain relative name so index.html can
            # use the same <link href="style.css"> as in file:// mode
            if "/" not in path.strip("/"):
                direct = os.path.normpath(path.strip("/"))
                if direct and not direct.startswith("..") and \
                        os.path.isfile(os.path.join(WEB_DIR, direct)):
                    return self._send_file(os.path.join(WEB_DIR, direct))

            parts = [p for p in path.split("/") if p]

            # GET /api/ping                            -> health check
            if parts == ["api", "ping"]:
                return self._send_json({"ok": True, "engine": "python"})

            # GET /api/textbooks                       -> list all textbooks
            if parts == ["api", "textbooks"]:
                return self._send_json({"textbooks": loader.scan_textbooks()})

            # GET /api/textbooks/<id>/book/<slot>      -> unit/lesson/task tree
            if (len(parts) == 5 and parts[0] == "api"
                    and parts[3] == "book" and parts[1] == "textbooks"):
                folder, manifest = loader.get_textbook_meta(parts[2])
                book = loader.load_book(folder, manifest, parts[4])
                slim = json.loads(json.dumps(book))
                for u in slim.get("units", []):
                    for l in u.get("lessons", []):
                        l["tasks"] = [{
                            "id": t.get("id"),
                            "title": t.get("title", ""),
                            "type": t.get("type", ""),
                        } for t in l.get("tasks", [])]
                        l["task_count"] = len(l["tasks"])
                return self._send_json(slim)

            # GET /api/textbooks/<id>/task/<slot>/<unit>/<lesson>/<task>
            if (len(parts) == 8 and parts[0] == "api" and parts[1] == "textbooks"
                    and parts[3] == "task"):
                _api, _tb, tb_id, _task, slot, unit_id, lesson_id, task_id = parts
                folder, manifest = loader.get_textbook_meta(tb_id)
                book = loader.load_book(folder, manifest, slot)
                task = dict(loader.find_task(book, unit_id, lesson_id, task_id))
                task["book_label"] = book.get("book_label")
                task["textbook_title"] = book.get("textbook_title")
                return self._send_json(task)

            # GET /api/search?q=<query>               -> quick search across all books
            if parts == ["api", "search"]:
                query = urllib.parse.parse_qs(parsed.query).get("q", [""])[0]
                return self._send_json({"results": loader.search_all(query)})

            # GET /assets/<textbook-id>/<file...>      -> textbook assets
            if parts and parts[0] == "assets" and len(parts) >= 3:
                return self._send_asset(parts[1], parts[2:])

            return self._send_json({"error": "Unknown endpoint"}, 404)
        except loader.TextbookError as exc:
            return self._send_json({"error": str(exc)}, 400)
        except Exception as exc:  # pragma: no cover
            return self._send_json({"error": "Server error: %s" % exc}, 500)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[intexebook] %s\n" % (fmt % args))


def main() -> None:
    ap = argparse.ArgumentParser(description="IntExeBook local server")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8000)))
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()

    os.makedirs(loader.TEXTBOOKS_DIR, exist_ok=True)
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    url = "http://%s:%d" % (args.host, args.port)
    print("=" * 60)
    print("  IntExeBook is running:  %s" % url)
    print("  Drop textbook folders or archives into:  ./textbooks")
    print("  Press Ctrl+C to stop.")
    print("=" * 60)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nBye!")


if __name__ == "__main__":
    main()
