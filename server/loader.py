"""
IntExeBook – modular textbook loader.

Every textbook lives in its own folder inside /textbooks and is described by a
manifest file (manifest.json | manifest.yaml | manifest.yml).  The same folder
may also contain an archive (zip / tar.gz / tgz) holding the manifest – the
archive is extracted automatically on first use.

Textbook folder structure (after extraction):

    textbooks/<folder>/
        manifest.json          # required: id, title, levels, covers...
        student.json           # optional: Student's Book content
        workbook.json          # optional: Workbook content
        assets/                # optional: images/audio served at /assets/...

Both JSON files use the same schema:

    {
      "units": [
        {
          "id": "u1", "title": "Unit 1 – Getting Started",
          "lessons": [
            {
              "id": "l1", "title": "Lesson 1 – Hello!", "page": 8,
              "tasks": [
                { "id": "t1", "title": "...", "type": "multiple-choice", ... }
              ]
            }
          ]
        }
      ]
    }

Task types understood by the player: multiple-choice, true-false, gap-fill,
word-order, matching.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tarfile
import tempfile
import urllib.parse
import zipfile
from typing import Any, Optional

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEXTBOOKS_DIR = os.path.join(ROOT, "textbooks")

MANIFEST_NAMES = ("manifest.json", "manifest.yaml", "manifest.yml")
ARCHIVE_EXTS = (".zip", ".tar.gz", ".tgz")


class TextbookError(Exception):
    pass


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _load_yaml(text: str) -> dict:
    """Very small YAML subset parser (mappings, lists, scalars).

    Used only when PyYAML is not installed; manifests are normally JSON.
    """
    try:
        import yaml  # type: ignore
        return yaml.safe_load(text)
    except ImportError:
        pass

    def parse_scalar(s: str) -> Any:
        s = s.strip()
        if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
            return s[1:-1]
        low = s.lower()
        if low in ("true", "yes"):
            return True
        if low in ("false", "no"):
            return False
        if low in ("null", "~", ""):
            return None
        try:
            return int(s)
        except ValueError:
            pass
        try:
            return float(s)
        except ValueError:
            return s.replace("_", " ")

    lines = [ln for ln in text.splitlines()
             if ln.strip() and not ln.lstrip().startswith("#")]

    def build(idx: int, indent: int):
        # list?
        container: Any = None
        while idx < len(lines):
            line = lines[idx]
            cur = len(line) - len(line.lstrip())
            if cur < indent:
                break
            if cur > indent:
                idx += 1
                continue
            stripped = line.strip()
            if stripped.startswith("- "):
                if container is None:
                    container = []
                item_value = stripped[2:]
                if ":" in item_value and not item_value.startswith(("\"", "'")):
                    key, _, rest = item_value.partition(":")
                    obj = {key.strip(): parse_scalar(rest)} if rest.strip() else {key.strip(): None}
                    # nested keys of the same list-item (indented deeper)
                    child_idx, child = build(idx + 1, cur + 2)
                    if isinstance(child, dict):
                        obj.update(child)
                    container.append(obj)
                    idx = child_idx
                else:
                    container.append(parse_scalar(item_value))
                    idx += 1
            elif ":" in stripped:
                if container is None:
                    container = {}
                key, _, rest = stripped.partition(":")
                key = key.strip()
                if rest.strip():
                    container[key] = parse_scalar(rest)
                    idx += 1
                else:
                    child_idx, child = build(idx + 1, cur + 2)
                    container[key] = child if child is not None else {}
                    idx = child_idx
            else:
                idx += 1
        return idx, container

    _, result = build(0, 0)
    return result or {}


def _read_manifest(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    if path.endswith(".json"):
        return json.loads(text)
    return _load_yaml(text)


def _find_manifest(folder: str) -> Optional[str]:
    for name in MANIFEST_NAMES:
        p = os.path.join(folder, name)
        if os.path.isfile(p):
            return p
    return None


def _safe_join(base: str, *parts: str) -> str:
    """Join and make sure the result stays inside *base*."""
    dest = os.path.realpath(os.path.join(base, *parts))
    base_r = os.path.realpath(base)
    if not dest.startswith(base_r + os.sep) and dest != base_r:
        raise TextbookError("Unsafe path in archive: %s" % dest)
    return dest


def _fix_zip_name(info: zipfile.ZipInfo) -> str:
    """Recover UTF-8 filenames from archives created without the UTF-8 flag
    (e.g. Windows Explorer zips with Cyrillic names). Python decodes such
    names as cp437; re-decoding the bytes as UTF-8 restores them."""
    name = info.filename.replace("\\", "/")
    if info.flag_bits & 0x800:          # proper UTF-8 flag set – trust it
        return name
    if not any(ord(c) > 127 for c in name):
        return name                      # plain ASCII – nothing to fix
    try:
        raw = name.encode("cp437")
    except UnicodeEncodeError:
        return name
    try:
        fixed = raw.decode("utf-8")
    except UnicodeDecodeError:
        return name
    return fixed if fixed != name else name


def _extract_zip(archive: str, target: str) -> None:
    with zipfile.ZipFile(archive) as zf:
        infos = {i: _fix_zip_name(i) for i in zf.infolist()}
        names = [(i, n) for i, n in infos.items() if not n.startswith("__MACOSX")]
        for member, n in names:
            if member.is_dir():
                continue
            dest = _safe_join(target, *n.split("/"))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with zf.open(member) as src, open(dest, "wb") as out:
                shutil.copyfileobj(src, out)


def _extract_tar(archive: str, target: str) -> None:
    with tarfile.open(archive, "r:*") as tf:
        members = [m for m in tf.getmembers()
                   if m.isfile() or m.isdir()]
        for m in members:
            if m.name.startswith("__MACOSX"):
                continue
            dest = _safe_join(target, *m.name.split("/"))
            if m.isdir():
                os.makedirs(dest, exist_ok=True)
            else:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                f = tf.extractfile(m)
                if f:
                    with open(dest, "wb") as out:
                        shutil.copyfileobj(f, out)


def _promote_single_root(tmp_dir: str) -> str:
    """If the archive contained one root folder, descend into it."""
    entries = [e for e in os.listdir(tmp_dir) if not e.startswith(".")]
    while len(entries) == 1 and os.path.isdir(os.path.join(tmp_dir, entries[0])):
        tmp_dir = os.path.join(tmp_dir, entries[0])
        entries = [e for e in os.listdir(tmp_dir) if not e.startswith(".")]
    return tmp_dir


def _folder_for_archive(archive: str) -> str:
    """Destination folder name for an archive (strips all archive extensions)."""
    name = os.path.basename(archive)
    for ext in sorted(ARCHIVE_EXTS, key=len, reverse=True):
        if name.lower().endswith(ext):
            return name[:-len(ext)]
    return name


def _ensure_folder(entry: str) -> Optional[str]:
    """Make sure textbooks/<entry> exists and contains a manifest.

    If it does not, look for an archive with the same name and unpack it.
    Returns the folder path or None if nothing usable was found.
    """
    folder = os.path.join(TEXTBOOKS_DIR, entry)

    # entry is itself an archive file -> unpack into <name-without-ext>/
    if os.path.isfile(folder) and entry.lower().endswith(ARCHIVE_EXTS):
        target = os.path.join(TEXTBOOKS_DIR, _folder_for_archive(entry))
        if not (os.path.isdir(target) and _find_manifest(target)):
            _unpack_into(folder, target)
        return target if _find_manifest(target) else None

    if os.path.isdir(folder) and _find_manifest(folder):
        return folder

    # find an archive to unpack (inside the folder itself or next to it)
    archive: Optional[str] = None
    if os.path.isdir(folder):
        for f in sorted(os.listdir(folder)):
            if f.lower().endswith(ARCHIVE_EXTS):
                archive = os.path.join(folder, f)
                break
    if archive is None:
        stem = _folder_for_archive(entry)
        for ext in ARCHIVE_EXTS:
            cand = os.path.join(TEXTBOOKS_DIR, stem + ext)
            if os.path.isfile(cand):
                archive = cand
                break

    if archive is None:
        return folder if os.path.isdir(folder) else None

    _unpack_into(archive, folder)
    return folder if _find_manifest(folder) else None


def _unpack_into(archive: str, folder: str) -> None:
    with tempfile.TemporaryDirectory(prefix="ieb_unpack_") as tmp:
        if archive.lower().endswith(".zip"):
            _extract_zip(archive, tmp)
        else:
            _extract_tar(archive, tmp)
        src = _promote_single_root(tmp)
        if not _find_manifest(src):
            raise TextbookError(
                "Archive '%s' does not contain a manifest file." % os.path.basename(archive))
        os.makedirs(folder, exist_ok=True)
        for item in os.listdir(src):
            s = os.path.join(src, item)
            d = os.path.join(folder, item)
            if os.path.isdir(s):
                shutil.copytree(s, d, dirs_exist_ok=True)
            else:
                shutil.copy2(s, d)


# --------------------------------------------------------------------------- #
# public API
# --------------------------------------------------------------------------- #
def scan_textbooks() -> list[dict]:
    """Return lightweight cards for every textbook found in /textbooks."""
    os.makedirs(TEXTBOOKS_DIR, exist_ok=True)
    cards: list[dict] = []
    for entry in sorted(os.listdir(TEXTBOOKS_DIR)):
        if entry.startswith((".", "_")):
            continue
        is_archive = entry.lower().endswith(ARCHIVE_EXTS)
        if not (os.path.isdir(os.path.join(TEXTBOOKS_DIR, entry)) or is_archive):
            continue
        try:
            folder = _ensure_folder(entry)
            if not folder:
                continue
            mpath = _find_manifest(folder)
            if not mpath:
                continue
            manifest = _read_manifest(mpath)
        except Exception as exc:  # broken textbook must not break the app
            cards.append({
                "folder": entry, "id": entry,
                "title": entry, "error": str(exc),
            })
            continue

        books = []
        for slot, label in (("student", "Student's Book"), ("workbook", "Workbook")):
            if manifest.get(slot + "_file") or manifest.get(slot):
                books.append({"slot": slot, "label": manifest.get(slot) or label})
        folder_name = os.path.basename(folder)
        cards.append({
            "folder": folder_name,
            "id": manifest.get("id") or folder_name,
            "title": manifest.get("title") or folder_name,
            "level": manifest.get("level", ""),
            "description": manifest.get("description", ""),
            "cover": manifest.get("cover", ""),
            "publisher": manifest.get("publisher", ""),
            "books": books,
        })
    # de-duplicate by card id (e.g. an archive and its unpacked folder coexist)
    seen: set[str] = set()
    unique = []
    for c in cards:
        key = c.get("id") or c.get("folder")
        if key in seen:
            continue
        seen.add(key)
        unique.append(c)
    return unique


def get_textbook_meta(folder_or_id: str) -> tuple[str, dict]:
    """Resolve a folder-name or textbook id -> (folder, manifest)."""
    os.makedirs(TEXTBOOKS_DIR, exist_ok=True)
    # direct folder hit (also accepts an exact folder name, not just manifest id)
    cand = os.path.join(TEXTBOOKS_DIR, folder_or_id)
    if (os.path.isdir(cand) and _find_manifest(cand)) or folder_or_id.lower().endswith(ARCHIVE_EXTS):
        folder = _ensure_folder(folder_or_id)
        if folder and _find_manifest(folder):
            return folder, _read_manifest(_find_manifest(folder))  # type: ignore
    # search by manifest id
    for entry in sorted(os.listdir(TEXTBOOKS_DIR)):
        if entry.startswith((".", "_")):
            continue
        if not (os.path.isdir(os.path.join(TEXTBOOKS_DIR, entry))
                or entry.lower().endswith(ARCHIVE_EXTS)):
            continue
        folder = _ensure_folder(entry)
        if not folder:
            continue
        mpath = _find_manifest(folder)
        if not mpath:
            continue
        manifest = _read_manifest(mpath)
        if (manifest.get("id") or entry) == folder_or_id:
            return folder, manifest
    raise TextbookError("Textbook not found: %s" % folder_or_id)


def load_book(folder: str, manifest: dict, slot: str) -> dict:
    """Load units for 'student' or 'workbook' slot."""
    if slot not in ("student", "workbook"):
        raise TextbookError("Unknown book slot: %s" % slot)
    if not manifest.get(slot):
        raise TextbookError("This textbook has no %s." % slot)
    file_name = manifest.get(slot + "_file") or (slot + ".json")
    path = _safe_join(folder, file_name)
    if not os.path.isfile(path):
        raise TextbookError("Content file missing: %s" % file_name)
    data = _read_manifest(path) if path.endswith((".yaml", ".yml")) else json.loads(
        open(path, encoding="utf-8").read())
    data.setdefault("units", [])
    data["book_label"] = manifest.get(slot) if isinstance(manifest.get(slot), str) \
        else ("Student's Book" if slot == "student" else "Workbook")
    data["textbook_title"] = manifest.get("title", "")
    return data


def find_task(book: dict, unit_id: str, lesson_id: str, task_id: str) -> dict:
    for unit in book.get("units", []):
        if unit.get("id") != unit_id:
            continue
        for lesson in unit.get("lessons", []):
            if lesson.get("id") != lesson_id:
                continue
            for task in lesson.get("tasks", []):
                if task.get("id") == task_id:
                    return task
    raise TextbookError("Task not found: %s/%s/%s" % (unit_id, lesson_id, task_id))


def asset_path(folder: str, rel: str) -> str:
    return _safe_join(folder, "assets", rel)


# --------------------------------------------------------------------------- #
# quick search across all textbooks
# --------------------------------------------------------------------------- #
_TYPE_ICONS = {
    "multiple-choice": "🔤", "true-false": "☑️", "gap-fill": "✏️",
    "word-order": "🧩", "matching": "🔗",
}
_MEDIA_ICONS = {"image": "🖼️", "audio": "🎧", "video": "🎬"}


def _task_icon(task: dict) -> str:
    """Icon for a task in search results (media tasks get their own icon)."""
    if task.get("type") == "media":
        media = task.get("media") or [{}]
        return _MEDIA_ICONS.get(media[0].get("type"), "🎬")
    return _TYPE_ICONS.get(task.get("type"), "⭐")


def search_all(query: str, limit: int = 60) -> list:
    """Case-insensitive substring search over every textbook / unit / lesson /
    task title.  Returns a flat list of result dicts with ready-to-use hashes."""
    tokens = [t for t in query.lower().split() if t]
    if not tokens:
        return []

    def matches(text: str) -> bool:
        low = (text or "").lower()
        return all(t in low for t in tokens)

    results = []
    for card in scan_textbooks():
        if card.get("error"):
            continue
        tb_hash = "#/tb/%s" % urllib.parse.quote(str(card["folder"]))
        tb_hit = matches(card.get("title", "")) or matches(card.get("subtitle", "")) \
            or matches(card.get("level", "")) or matches(card.get("description", ""))
        if tb_hit:
            results.append({
                "kind": "textbook", "icon": card.get("icon") or "📕",
                "title": card.get("title", ""),
                "subtitle": card.get("subtitle") or card.get("level") or "",
                "hash": tb_hash,
            })
        folder = os.path.join(TEXTBOOKS_DIR, card["folder"])
        mpath = _find_manifest(folder)
        if not mpath:
            continue
        manifest = _read_manifest(mpath)
        for slot in ("student", "workbook"):
            if not manifest.get(slot):
                continue
            try:
                book = load_book(folder, manifest, slot)
            except TextbookError:
                continue
            book_label = book.get("book_label") or slot
            for unit in book.get("units", []):
                u_hash = "%s/%s/%s" % (tb_hash, slot, urllib.parse.quote(str(unit.get("id"))))
                if matches(unit.get("title", "")):
                    results.append({
                        "kind": "unit", "icon": "📚",
                        "title": unit.get("title", ""),
                        "subtitle": "%s · %s" % (card.get("title", ""), book_label),
                        "hash": u_hash,
                    })
                for lesson in unit.get("lessons", []):
                    l_hash = "%s/%s" % (u_hash, urllib.parse.quote(str(lesson.get("id"))))
                    if matches(lesson.get("title", "")):
                        results.append({
                            "kind": "lesson", "icon": "📖",
                            "title": lesson.get("title", ""),
                            "subtitle": "%s · %s · %s" % (card.get("title", ""),
                                                          unit.get("title", ""), book_label),
                            "hash": l_hash,
                        })
                    for task in lesson.get("tasks", []):
                        if matches(task.get("title", "")):
                            results.append({
                                "kind": "task",
                                "icon": _TYPE_ICONS.get(task.get("type"), "⭐"),
                                "title": task.get("title", ""),
                                "subtitle": "%s · %s · %s" % (card.get("title", ""),
                                                              lesson.get("title", ""), book_label),
                                "hash": "%s/play/%s" % (l_hash, urllib.parse.quote(str(task.get("id")))),
                            })
        if len(results) >= limit:
            break
    return results[:limit]
