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
import time
import tarfile
import tempfile
import urllib.parse
import zipfile
from typing import Any, Optional

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEXTBOOKS_DIR = os.environ.get("IEB_TEXTBOOKS") or os.path.join(ROOT, "textbooks")

# where drafts of teacher-made courses are kept (autosave / restore)
DRAFTS_DIR = os.environ.get("IEB_DRAFTS") or os.path.join(TEXTBOOKS_DIR, "_drafts")

# PUBLISHED SHARING FOLDER -------------------------------------------------
# Teacher-made courses that are ready to be handed out live in their own
# folder next to the app:  shared-exercises/<course>/  (same textbook layout:
# manifest.json + student.json/workbook.json + assets/).  The whole folder is
# copy-paste shareable, and every course additionally gets a one-file pack
# <course>.iebpack.json written next to it for chat / e-mail / USB sharing.
SHARED_DIR = os.environ.get("IEB_SHARED_EXERCISES") or os.path.join(ROOT, "shared-exercises")

MANIFEST_NAMES = ("manifest.json", "manifest.yaml", "manifest.yml")
ARCHIVE_EXTS = (".zip", ".tar.gz", ".tgz")
PACK_EXT = ".iebpack.json"

TASK_TYPES = ("multiple-choice", "true-false", "gap-fill", "word-order", "matching",
              "choose-odd-one-out", "find-and-click", "click-on-picture",
              "word-search", "translate-match",
              # extended set (v2): audio / video / text skills
              "listen-choice", "dictation", "listen-gap", "video-quiz",
              "video-sequence", "reading-truefalse", "short-answer", "spelling",
              "multiple-select", "reorder-text", "categorize", "crosswords",
              "sentence-transform", "error-correction", "initials",
              "choose-picture", "timeline", "definition-match", "memory-pairs",
              "speaking-repeat")


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


def _zip_recover(archive: str, target: str) -> bool:
    """Walk local file headers (PK\\3\\4) directly and extract every readable
    member.  Works even when the central directory at the tail of the .zip is
    corrupted or stores bogus data offsets.  Returns True on any success."""
    try:
        with open(archive, "rb") as fh:
            buf = fh.read()
    except OSError:
        return False
    wrote_any = False
    for name, method, start, comp, uncomp in _iter_local_headers(buf):
        if not name or name.startswith("__MACOSX"):
            continue
        data = buf[start:start + comp]
        if method == 8:
            import zlib
            try:
                data = zlib.decompress(data, -15)
            except zlib.error:
                continue
        elif method != 0:
            continue
        try:
            dest = _safe_join(target, *name.split("/"))
        except TextbookError:
            continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as fh:
            fh.write(data)
        wrote_any = True
    return wrote_any


def _extract_zip(archive: str, target: str) -> None:
    extracted = False
    try:
        with zipfile.ZipFile(archive) as zf:
            infos = {i: _fix_zip_name(i) for i in zf.infolist()}
            names = [(i, n) for i, n in infos.items() if not n.startswith("__MACOSX")]
            for member, n in names:
                if member.is_dir():
                    continue
                try:
                    dest = _safe_join(target, *n.split("/"))
                except TextbookError:
                    continue
                try:
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    with zf.open(member) as src, open(dest, "wb") as out:
                        shutil.copyfileobj(src, out)
                    extracted = True
                except (OSError, zipfile.BadZipFile):
                    # central directory lies about this entry's data offset —
                    # handled by the recovery pass below
                    pass
    except zipfile.BadZipFile:
        pass  # fully damaged central directory — rely on recovery below

    # A healthy zip yields a manifest; if we cannot find one, some entries were
    # skipped by the normal path — re-extract everything from raw local headers.
    if not _find_manifest_deep(target):
        if _zip_recover(archive, target) and _find_manifest_deep(target):
            return
        if not extracted:
            raise TextbookError("Could not read '%s' — the archive looks damaged."
                                % os.path.basename(archive))


def _find_manifest_deep(folder: str) -> Optional[str]:
    """Manifest search that also descends into a single root folder created by
    archive extraction (e.g. sunny-book.zip/Учебник Пример/manifest.json)."""
    if not os.path.isdir(folder):
        return None
    direct = _find_manifest(folder)
    if direct:
        return direct
    entries = [e for e in os.listdir(folder) if not e.startswith(".")
               and os.path.isdir(os.path.join(folder, e))]
    if len(entries) == 1:
        return _find_manifest(os.path.join(folder, entries[0]))
    return None


# --------------------------------------------------------------------------- #
# damaged-zip recovery
# --------------------------------------------------------------------------- #
# When the central directory at the tail of a .zip is truncated or corrupted,
# zipfile raises BadZipFile and the whole textbook becomes unusable.  The data
# blobs are usually still intact, so we walk the local file headers (PK\3\4)
# ourselves – each one stores its own CRC and compressed size.

_LOC_HDR_SIG = b"PK\x03\x04"
_DATA_DESC_SIG = b"PK\x07\x08"


def _iter_local_headers(buf: bytes):
    pos = 0
    n = len(buf)
    while pos + 30 <= n:
        i = buf.find(_LOC_HDR_SIG, pos)
        if i < 0:
            return
        pos = i
        flag_bits = int.from_bytes(buf[i + 6:i + 8], "little")
        method = int.from_bytes(buf[i + 8:i + 10], "little")
        crc = int.from_bytes(buf[i + 14:i + 18], "little")
        comp = int.from_bytes(buf[i + 18:i + 22], "little")
        uncomp = int.from_bytes(buf[i + 22:i + 26], "little")
        name_len = int.from_bytes(buf[i + 26:i + 28], "little")
        extra_len = int.from_bytes(buf[i + 28:i + 30], "little")
        # healthy stored entries have comp == uncomp; if that invariant is
        # broken the signature we found is just random data inside a blob.
        if method == 0 and comp > 0 and crc != 0 and uncomp != comp:
            return
        raw = buf[i + 30:i + 30 + name_len]
        try:
            name = raw.decode("utf-8")
        except UnicodeDecodeError:
            name = raw.decode("cp437")
        name = name.replace("\\", "/")
        start = i + 30 + name_len + extra_len
        if name and ".." not in name.split("/") and start + comp <= n:
            yield name, method, start, comp, uncomp
        pos = start + comp
        if flag_bits & 0x8:                       # streamed sizes follow data
            if pos + 12 <= n:
                if buf[pos:pos + 4] == _DATA_DESC_SIG:
                    pos += 4
                pos += 12


def extract_asset_from_archive(archive: str, rel: str, folder: str) -> bool:
    """Extract one member (``assets/<rel>``) from *archive* into *folder*.

    Tries zipfile first; if the archive is too damaged for it, falls back to
    reading local file headers directly.  Returns True when the file was
    written.  Never raises for unreadable archives."""
    rel = rel.replace("\\", "/").lstrip("/")
    wanted = ("assets/" + rel, rel)
    try:
        with zipfile.ZipFile(archive) as zf:
            for info in zf.infolist():
                name = _fix_zip_name(info)
                if name.rstrip("/") in wanted or \
                        any(n.endswith("/" + wanted[0]) for n in (name,)):
                    data = zf.read(info)
                    dest = _safe_join(folder, *wanted[0].split("/"))
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    with open(dest, "wb") as fh:
                        fh.write(data)
                    return True
    except Exception:
        pass
    try:
        with open(archive, "rb") as fh:
            buf = fh.read()
    except OSError:
        return False
    for name, method, start, comp, _uncomp in _iter_local_headers(buf):
        if name.rstrip("/") not in wanted and not name.endswith("/" + wanted[0]):
            continue
        data = buf[start:start + comp]
        if method == 8:
            import zlib
            try:
                data = zlib.decompress(data, -15)
            except zlib.error:
                return False
        elif method != 0:
            return False
        dest = _safe_join(folder, *wanted[0].split("/"))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as fh:
            fh.write(data)
        return True
    return False


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
# authoring: validation, creating / editing textbooks, drafts and packs
# --------------------------------------------------------------------------- #
# These functions mirror web/shared.js (the single source of truth for the
# content format).  The browser editor validates before saving; the server
# re-validates everything it writes so a hand-edited or imported file can
# never corrupt the textbook catalogue.

import base64
import binascii
import re as _re


def _s(v) -> str:
    return v.strip() if isinstance(v, str) else ""


def validate_task(raw: Any) -> dict:
    """Return {'ok', 'errors', 'warnings', 'value'} for one task object."""
    errors: list[str] = []
    warnings: list[str] = []
    if not isinstance(raw, dict):
        return {"ok": False, "errors": ["task must be an object"], "warnings": [], "value": None}
    ttype = _s(raw.get("type"))
    if ttype not in TASK_TYPES:
        errors.append("unknown task type “%s”" % (ttype or "?"))
    title = _s(raw.get("title")) or "Untitled task"
    out: dict = {"id": _s(raw.get("id")) or "task", "type": ttype or "multiple-choice",
                 "title": title, "instruction": _s(raw.get("instruction"))}

    media_in = raw.get("media")
    if media_in is not None:
        if not isinstance(media_in, list):
            errors.append("media must be a list")
        else:
            clean_media = []
            for i, m in enumerate(media_in):
                at = "media[%d]" % i
                if not isinstance(m, dict):
                    errors.append(at + " must be an object"); continue
                mt = _s(m.get("type"))
                if mt not in ("image", "audio", "video"):
                    errors.append(at + ": type must be image, audio or video"); continue
                src = _s(m.get("src"))
                if not src:
                    errors.append(at + ": file is missing"); continue
                item = {"type": mt, "src": src}
                if _s(m.get("caption")):
                    item["caption"] = _s(m.get("caption"))
                clean_media.append(item)
            if clean_media:
                out["media"] = clean_media
    if _s(raw.get("explanation")):
        out["explanation"] = _s(raw.get("explanation"))

    if ttype == "multiple-choice":
        opts = [_s(o) for o in raw.get("options") or []] if isinstance(raw.get("options"), list) else []
        if len([o for o in opts if o]) < 2:
            errors.append("needs at least 2 answer options")
        try:
            ai = int(raw.get("answerIndex"))
        except (TypeError, ValueError):
            ai = -1
        if not (0 <= ai < len(opts)):
            errors.append("no correct option marked")
        out["options"] = opts
        out["answerIndex"] = ai
    elif ttype == "true-false":
        if not isinstance(raw.get("answer"), bool):
            errors.append("answer must be true or false")
        out["answer"] = bool(raw.get("answer"))
    elif ttype == "gap-fill":
        text = _s(raw.get("text"))
        n_gaps = len(_re.findall(r"_{2,}", text))
        blanks = raw.get("blanks") if isinstance(raw.get("blanks"), list) else []
        if not text:
            errors.append("sentence text is empty")
        if not n_gaps:
            errors.append("no gaps found — use ___ in the text")
        if n_gaps and len(blanks) != n_gaps:
            errors.append("%d gap(s) in the text but %d answer(s) given" % (n_gaps, len(blanks)))
        clean_blanks = []
        for i, b in enumerate(blanks):
            ans = [a for a in map(_s, (b.get("answers") if isinstance(b, dict) and isinstance(b.get("answers"), list) else [])) if a]
            if not ans:
                errors.append("gap %d has no accepted answer" % (i + 1))
            item = {"answers": ans}
            if isinstance(b, dict) and _s(b.get("hint")):
                item["hint"] = _s(b.get("hint"))
            clean_blanks.append(item)
        out["text"] = text
        out["blanks"] = clean_blanks
    elif ttype == "word-order":
        words = [_s(w) for w in (raw.get("words") or []) if _s(w)] if isinstance(raw.get("words"), list) else []
        answer = _s(raw.get("answer")) or " ".join(words)
        if len(words) < 2:
            errors.append("needs at least 2 words")
        tokens = [w for w in answer.split() if w]
        if len(tokens) != len(words):
            errors.append("the answer has %d word(s) but you provided %d tiles" % (len(tokens), len(words)))
        else:
            pool = sorted(w.lower() for w in words)
            need = sorted(w.lower() for w in tokens)
            if pool != need:
                warnings.append("answer uses words that are not in the tile list")
        out["words"] = words
        out["answer"] = answer
    elif ttype == "matching":
        pairs = raw.get("pairs") if isinstance(raw.get("pairs"), list) else []
        if len(pairs) < 2:
            errors.append("needs at least 2 pairs")
        seen: set = set()
        clean_pairs = []
        for i, p in enumerate(pairs):
            l = _s(p.get("left")) if isinstance(p, dict) else ""
            r = _s(p.get("right")) if isinstance(p, dict) else ""
            if not l or not r:
                errors.append("pair %d is incomplete (both sides needed)" % (i + 1))
            elif l.lower() in seen:
                errors.append("duplicate left item “%s”" % l)
            else:
                seen.add(l.lower())
                clean_pairs.append({"left": l, "right": r})
        out["pairs"] = clean_pairs
    elif ttype == "choose-odd-one-out":
        raw_opts = raw.get("options") if isinstance(raw.get("options"), list) else []
        oo = []
        for i, o in enumerate(raw_opts):
            text = _s(o.get("text")) if isinstance(o, dict) else _s(o)
            if not text:
                errors.append("option %d is empty" % (i + 1)); continue
            oo.append({"text": text, "isOdd": bool(o.get("isOdd")) if isinstance(o, dict) else False})
        n_odd = sum(1 for o in oo if o["isOdd"])
        if len(oo) < 3:
            errors.append("needs at least 3 options")
        if not n_odd:
            errors.append("mark at least one option as \u201codd one out\u201d")
        if n_odd >= len(oo):
            errors.append("keep at least one option that belongs to the category")
        out["options"] = oo
        if _s(raw.get("categoryHint")):
            out["categoryHint"] = _s(raw.get("categoryHint"))
    elif ttype == "find-and-click":
        fc_text = _s(raw.get("text"))
        fc_targets = [t for t in map(_s, (raw.get("targets") or [])) if t] if isinstance(raw.get("targets"), list) else []
        if not fc_text:
            errors.append("the sentence / text is empty")
        if not fc_targets:
            errors.append("add at least one word the student must click")
        low = fc_text.lower()
        for t in fc_targets:
            if t.lower() not in low:
                warnings.append("target \u201c%s\u201d does not appear in the text" % t)
        out["text"] = fc_text
        out["targets"] = fc_targets
        out["mode"] = _s(raw.get("mode")) or "words"
    elif ttype == "click-on-picture":
        cp_img = _s(raw.get("image"))
        if not cp_img:
            errors.append("attach a picture first (Media tab or the file picker)")
        spots = raw.get("hotspots") if isinstance(raw.get("hotspots"), list) else []
        cp_clean = []
        for i, sp in enumerate(spots):
            if not isinstance(sp, dict) or not _s(sp.get("label")):
                errors.append("hotspot %d needs a label" % (i + 1)); continue
            try:
                x = float(sp.get("x")); y = float(sp.get("y"))
            except (TypeError, ValueError):
                errors.append("hotspot \u201c%s\u201d has invalid coordinates" % sp.get("label")); continue
            if not (0 <= x <= 100 and 0 <= y <= 100):
                errors.append("hotspot \u201c%s\u201d has coordinates outside the picture (use 0-100 %%)" % sp.get("label")); continue
            try:
                r = max(4.0, float(sp.get("r")))
            except (TypeError, ValueError):
                r = 8.0
            cp_clean.append({"label": _s(sp.get("label")), "x": x, "y": y, "r": r})
        if not cp_clean:
            errors.append("add at least one hotspot")
        out["image"] = cp_img
        out["hotspots"] = cp_clean
    elif ttype == "word-search":
        ws_words = []
        for w in (raw.get("words") or []) if isinstance(raw.get("words"), list) else []:
            wu = _re.sub("[^A-Z\u0410-\u042f\u0401]", "", _s(w).upper())
            if wu:
                ws_words.append(wu)
        ws_grid = [_s(r).upper() for r in (raw.get("grid") or []) if _s(r)] if isinstance(raw.get("grid"), list) else []
        if len(ws_words) < 2:
            errors.append("add at least 2 words to hide")
        if not ws_grid:
            errors.append("the grid is empty — generate it in the editor")
        if ws_grid and any(len(w) > max(len(r) for r in ws_grid) for w in ws_words):
            errors.append("a word is longer than the grid — regenerate with a bigger size")
        out["words"] = ws_words
        out["grid"] = ws_grid
        if _s(raw.get("note")):
            out["note"] = _s(raw.get("note"))
    elif ttype == "translate-match":
        tm_pairs = raw.get("pairs") if isinstance(raw.get("pairs"), list) else []
        if len(tm_pairs) < 2:
            errors.append("needs at least 2 pairs")
        tm_seen = set()
        tm_clean = []
        for i, p in enumerate(tm_pairs):
            l = _s(p.get("left")) if isinstance(p, dict) else ""
            r = _s(p.get("right")) if isinstance(p, dict) else ""
            if not l or not r:
                errors.append("pair %d is incomplete (both sides needed)" % (i + 1))
            elif l.lower() in tm_seen:
                errors.append("duplicate left item \u201c%s\u201d" % l)
            else:
                tm_seen.add(l.lower())
                tm_clean.append({"left": l, "right": r})
        out["pairs"] = tm_clean
    elif ttype == "listen-choice":
        lc_opts = [_s(o) for o in raw.get("options") or []] if isinstance(raw.get("options"), list) else []
        if len([o for o in lc_opts if o]) < 2:
            errors.append("needs at least 2 answer options")
        try:
            lc_ai = int(raw.get("answerIndex"))
        except (TypeError, ValueError):
            lc_ai = -1
        if not (0 <= lc_ai < len(lc_opts)):
            errors.append("no correct option marked")
        if not isinstance(raw.get("media"), list) or not raw.get("media"):
            warnings.append("attach an audio clip in the Media tab — this is a listening task")
        out["options"] = lc_opts
        out["answerIndex"] = lc_ai
    elif ttype == "dictation":
        dic_text = _s(raw.get("text"))
        if not dic_text:
            errors.append("the dictation text (what the student should type) is empty")
        if not isinstance(raw.get("media"), list) or not raw.get("media"):
            warnings.append("attach an audio clip in the Media tab — this is a listening task")
        out["text"] = dic_text
    elif ttype == "listen-gap":
        lg_text = _s(raw.get("text"))
        lg_gaps = len(_re.findall(r"_{2,}", lg_text))
        lg_blanks = raw.get("blanks") if isinstance(raw.get("blanks"), list) else []
        if not lg_text:
            errors.append("the lyrics / sentence text is empty")
        if not lg_gaps:
            errors.append("no gaps found — use ___ in the text")
        if lg_gaps and len(lg_blanks) != lg_gaps:
            errors.append("%d gap(s) in the text but %d answer(s) given" % (lg_gaps, len(lg_blanks)))
        lg_clean = []
        for i, b in enumerate(lg_blanks):
            ans = [a for a in map(_s, (b.get("answers") if isinstance(b, dict) and isinstance(b.get("answers"), list) else [])) if a]
            if not ans:
                errors.append("gap %d has no accepted answer" % (i + 1))
            item = {"answers": ans}
            if isinstance(b, dict) and _s(b.get("hint")):
                item["hint"] = _s(b.get("hint"))
            lg_clean.append(item)
        out["text"] = lg_text
        out["blanks"] = lg_clean
        if not isinstance(raw.get("media"), list) or not raw.get("media"):
            warnings.append("attach an audio clip in the Media tab — this is a listening task")
    elif ttype == "video-quiz":
        vq_list = raw.get("questions") if isinstance(raw.get("questions"), list) else []
        if not vq_list:
            errors.append("add at least one question about the video")
        vq_clean = []
        for i, q in enumerate(vq_list):
            qt = _s(q.get("text")) if isinstance(q, dict) else ""
            qo = [_s(o) for o in q.get("options")] if isinstance(q, dict) and isinstance(q.get("options"), list) else []
            try:
                qa = int(q.get("answerIndex")) if isinstance(q, dict) else -1
            except (TypeError, ValueError):
                qa = -1
            if not qt:
                errors.append("question %d has no text" % (i + 1))
            if len([o for o in qo if o]) < 2:
                errors.append("question %d needs at least 2 options" % (i + 1))
            if not (0 <= qa < len(qo)):
                errors.append("question %d has no correct option marked" % (i + 1))
            vq_clean.append({"text": qt, "options": qo, "answerIndex": qa})
        out["questions"] = vq_clean
        media_in2 = raw.get("media") if isinstance(raw.get("media"), list) else []
        if not any(isinstance(m, dict) and _s(m.get("type")) == "video" for m in media_in2):
            warnings.append("attach a video clip in the Media tab")
    elif ttype == "video-sequence":
        vs_items = [_s(x) for x in (raw.get("items") or []) if _s(x)] if isinstance(raw.get("items"), list) else []
        if len(vs_items) < 3:
            errors.append("needs at least 3 events to order")
        out["items"] = vs_items
    elif ttype == "reading-truefalse":
        rt_passage = _s(raw.get("passage"))
        if not rt_passage:
            errors.append("the reading passage is empty")
        rt_st = raw.get("statements") if isinstance(raw.get("statements"), list) else []
        if len(rt_st) < 2:
            errors.append("add at least 2 statements")
        rt_clean = []
        for i, s in enumerate(rt_st):
            st = _s(s.get("text")) if isinstance(s, dict) else ""
            if not st:
                errors.append("statement %d is empty" % (i + 1)); continue
            if not isinstance(s, dict) or not isinstance(s.get("answer"), bool):
                errors.append("statement %d must be marked true or false" % (i + 1))
            rt_clean.append({"text": st, "answer": bool(isinstance(s, dict) and s.get("answer"))})
        out["passage"] = rt_passage
        out["statements"] = rt_clean
    elif ttype == "short-answer":
        sa_q = _s(raw.get("question"))
        sa_ans = [a for a in map(_s, (raw.get("answers") or [])) if a] if isinstance(raw.get("answers"), list) else []
        if not sa_q:
            errors.append("the question is empty")
        if not sa_ans:
            errors.append("add at least one accepted answer")
        out["question"] = sa_q
        out["answers"] = sa_ans
        if _s(raw.get("model")):
            out["model"] = _s(raw.get("model"))
    elif ttype == "spelling":
        sp_word = _s(raw.get("word"))
        if not sp_word:
            errors.append("the target word is empty")
        if _re.search(r"[.,!?]", sp_word):
            errors.append("the word itself should not contain punctuation")
        out["word"] = sp_word
        if _s(raw.get("prompt")):
            out["prompt"] = _s(raw.get("prompt"))
    elif ttype == "multiple-select":
        ms_raw = raw.get("options") if isinstance(raw.get("options"), list) else []
        ms_clean = []
        for i, o in enumerate(ms_raw):
            t = _s(o.get("text")) if isinstance(o, dict) else _s(o)
            if not t:
                errors.append("option %d is empty" % (i + 1)); continue
            ms_clean.append({"text": t, "correct": bool(o.get("correct")) if isinstance(o, dict) else False})
        ms_ok = sum(1 for o in ms_clean if o["correct"])
        if len(ms_clean) < 3:
            errors.append("needs at least 3 options")
        if not ms_ok:
            errors.append("mark at least one option as correct")
        if ms_ok >= len(ms_clean):
            errors.append("keep at least one wrong option")
        out["options"] = ms_clean
    elif ttype == "reorder-text":
        ro_lines = [_s(x) for x in (raw.get("lines") or []) if _s(x)] if isinstance(raw.get("lines"), list) else []
        if len(ro_lines) < 3:
            errors.append("needs at least 3 lines in the correct order")
        out["lines"] = ro_lines
    elif ttype == "categorize":
        cg_cats = raw.get("categories") if isinstance(raw.get("categories"), list) else []
        if len(cg_cats) < 2:
            errors.append("needs at least 2 categories")
        cg_clean, cg_names = [], set()
        for i, c in enumerate(cg_cats):
            name = _s(c.get("name")) if isinstance(c, dict) else ""
            items = [x for x in map(_s, (c.get("items") if isinstance(c, dict) and isinstance(c.get("items"), list) else [])) if x]
            if not name:
                errors.append("category %d has no name" % (i + 1))
            elif name.lower() in cg_names:
                errors.append("duplicate category “%s”" % name)
            elif not items:
                errors.append("category “%s” has no items" % name)
            else:
                cg_names.add(name.lower())
                cg_clean.append({"name": name, "items": items})
        if sum(len(c["items"]) for c in cg_clean) < 3:
            errors.append("add at least 3 items in total")
        out["categories"] = cg_clean
    elif ttype == "crosswords":
        cw_cells = raw.get("cells") if isinstance(raw.get("cells"), list) else []
        cw_clues = raw.get("clues") if isinstance(raw.get("clues"), list) else []
        if not cw_cells:
            errors.append("draw the grid first — click cells in the editor preview (or use the generator)")
        if len(cw_clues) < 2:
            errors.append("add at least 2 clues")
        cw_clean = []
        for i, cl in enumerate(cw_clues):
            w = _re.sub("[^A-Z\u0410-\u042f\u0401]", "", str(cl.get("word") or "").upper()) if isinstance(cl, dict) else ""
            d = _s(cl.get("dir")) if isinstance(cl, dict) else ""
            q = _s(cl.get("clue")) if isinstance(cl, dict) else ""
            if not w or d not in ("across", "down") or not q:
                errors.append("clue %d: word, direction (across/down) and clue text are required" % (i + 1))
            else:
                cw_clean.append({"word": w, "dir": d, "clue": q})
        cw_grid = set()
        for c in cw_cells:
            if isinstance(c, dict):
                try:
                    cw_grid.add((int(c.get("x")), int(c.get("y"))))
                except (TypeError, ValueError):
                    pass
        for cl in cw_clean:
            dx, dy = (1, 0) if cl["dir"] == "across" else (0, 1)
            fits = any(all((sx + dx * k, sy + dy * k) in cw_grid for k in range(len(cl["word"])))
                       for sx, sy in cw_grid)
            if not fits:
                errors.append("word “%s” does not fit into the drawn grid" % cl["word"])
        out["cells"] = [{"x": int(c.get("x") or 0), "y": int(c.get("y") or 0)}
                        for c in cw_cells if isinstance(c, dict)]
        out["clues"] = cw_clean
    elif ttype == "sentence-transform":
        st_src = _s(raw.get("source"))
        st_ans = [a for a in map(_s, (raw.get("answers") or [])) if a] if isinstance(raw.get("answers"), list) else []
        if not st_src:
            errors.append("the source sentence is empty")
        if not st_ans:
            errors.append("add at least one accepted transformed sentence")
        out["source"] = st_src
        if _s(raw.get("task")):
            out["task"] = _s(raw.get("task"))
        out["answers"] = st_ans
    elif ttype == "error-correction":
        ec_sent = _s(raw.get("sentence"))
        ec_tok = [w for w in ec_sent.split() if w]
        try:
            ec_idx = int(raw.get("wrongIndex"))
        except (TypeError, ValueError):
            ec_idx = -1
        if not ec_sent:
            errors.append("the sentence is empty")
        if len(ec_tok) < 3:
            errors.append("the sentence needs at least 3 words")
        if not (0 <= ec_idx < len(ec_tok)):
            errors.append("mark which word is wrong (click it in the editor preview)")
        out["sentence"] = ec_sent
        out["wrongIndex"] = ec_idx
        if _s(raw.get("fix")):
            out["fix"] = _s(raw.get("fix"))
    elif ttype == "initials":
        ini_items = raw.get("items") if isinstance(raw.get("items"), list) else []
        ini_clean = []
        for i, it in enumerate(ini_items):
            w = _s(it.get("word")) if isinstance(it, dict) else ""
            if not w:
                errors.append("item %d has no word" % (i + 1)); continue
            ini = (_s(it.get("initial"))[:1].lower() if isinstance(it, dict) and _s(it.get("initial")) else w[0].lower())
            ini_clean.append({"word": w, "initial": ini})
        if len(ini_clean) < 2:
            errors.append("add at least 2 words")
        out["items"] = ini_clean
    elif ttype == "choose-picture":
        cp_pics = raw.get("images") if isinstance(raw.get("images"), list) else []
        if len(cp_pics) < 2:
            errors.append("add at least 2 pictures")
        cp_clean, cp_ok = [], 0
        for i, p in enumerate(cp_pics):
            src = _s(p.get("src")) if isinstance(p, dict) else ""
            if not src:
                errors.append("picture %d is missing — upload images in the Content form" % (i + 1)); continue
            ok = bool(p.get("correct")) if isinstance(p, dict) else False
            if ok:
                cp_ok += 1
            cp_clean.append({"src": src, "caption": _s(p.get("caption")) if isinstance(p, dict) else "", "correct": ok})
        if not cp_ok:
            errors.append("mark one picture as the correct answer")
        if cp_ok >= len(cp_clean):
            errors.append("keep at least one wrong picture")
        if not _s(raw.get("prompt")):
            errors.append("the prompt (question / word the student matches) is empty")
        out["prompt"] = _s(raw.get("prompt"))
        out["images"] = cp_clean
    elif ttype == "timeline":
        tl_ev = raw.get("events") if isinstance(raw.get("events"), list) else []
        if len(tl_ev) < 3:
            errors.append("needs at least 3 events")
        tl_clean = []
        for i, e in enumerate(tl_ev):
            lab = _s(e.get("label")) if isinstance(e, dict) else ""
            dt = _s(e.get("date")) if isinstance(e, dict) else ""
            if not lab:
                errors.append("event %d has no label" % (i + 1))
            else:
                tl_clean.append({"label": lab} if not dt else {"label": lab, "date": dt})
        out["events"] = tl_clean
    elif ttype == "definition-match":
        dm_pairs = raw.get("pairs") if isinstance(raw.get("pairs"), list) else []
        if len(dm_pairs) < 2:
            errors.append("needs at least 2 word/definition pairs")
        dm_seen, dm_clean = set(), []
        for i, p in enumerate(dm_pairs):
            l = _s(p.get("left")) if isinstance(p, dict) else ""
            r = _s(p.get("right")) if isinstance(p, dict) else ""
            if not l or not r:
                errors.append("pair %d is incomplete (word + definition needed)" % (i + 1))
            elif l.lower() in dm_seen:
                errors.append("duplicate word “%s”" % l)
            else:
                dm_seen.add(l.lower())
                dm_clean.append({"left": l, "right": r})
        out["pairs"] = dm_clean
    elif ttype == "memory-pairs":
        mp_pairs = raw.get("pairs") if isinstance(raw.get("pairs"), list) else []
        if len(mp_pairs) < 3:
            errors.append("needs at least 3 card pairs")
        mp_clean = []
        for i, p in enumerate(mp_pairs):
            f = _s(p.get("front")) if isinstance(p, dict) else ""
            b = _s(p.get("back")) if isinstance(p, dict) else ""
            if not f or not b:
                errors.append("pair %d is incomplete (front + back needed)" % (i + 1))
            else:
                mp_clean.append({"front": f, "back": b})
        out["pairs"] = mp_clean
    elif ttype == "speaking-repeat":
        sr_text = _s(raw.get("modelText"))
        if not sr_text:
            errors.append("the model phrase the student repeats is empty")
        out["modelText"] = sr_text

    return {"ok": not errors, "errors": errors, "warnings": warnings, "value": out}


def validate_book(data: Any) -> dict:
    """Validate a student/workbook JSON tree. Returns {'ok','errors','warnings','stats','value'}."""
    errors: list[str] = []
    warnings: list[str] = []
    stats = {"units": 0, "lessons": 0, "tasks": 0}
    if not isinstance(data, dict):
        return {"ok": False, "errors": ["content must be a JSON object"], "warnings": warnings,
                "stats": stats, "value": None}
    units = data.get("units")
    if not isinstance(units, list):
        return {"ok": False, "errors": ['missing "units" array'], "warnings": warnings,
                "stats": stats, "value": None}
    if not units:
        errors.append("there are no units yet — add at least one")
    clean_units = []
    seen_units: set = set()
    for ui, u in enumerate(units):
        u_at = "unit %d" % (ui + 1)
        if not isinstance(u, dict):
            errors.append(u_at + " must be an object"); continue
        uid = _s(u.get("id")) or ("u%d" % (ui + 1))
        if uid in seen_units:
            errors.append('%s: duplicate unit id "%s"' % (u_at, uid)); continue
        seen_units.add(uid)
        if not _s(u.get("title")):
            warnings.append('%s ("%s") has no title' % (u_at, uid))
        lessons = u.get("lessons") if isinstance(u.get("lessons"), list) else []
        if not lessons:
            warnings.append('unit "%s" has no lessons' % (_s(u.get("title")) or uid))
        clean_lessons = []
        seen_lessons: set = set()
        for li, l in enumerate(lessons):
            l_at = "%s, lesson %d" % (u_at, li + 1)
            if not isinstance(l, dict):
                errors.append(l_at + " must be an object"); continue
            lid = _s(l.get("id")) or ("l%d" % (li + 1))
            if lid in seen_lessons:
                errors.append('%s: duplicate lesson id "%s"' % (l_at, lid)); continue
            seen_lessons.add(lid)
            if not _s(l.get("title")):
                warnings.append('%s ("%s") has no title' % (l_at, lid))
            tasks = l.get("tasks") if isinstance(l.get("tasks"), list) else []
            if not tasks:
                warnings.append('lesson "%s" has no tasks' % (_s(l.get("title")) or lid))
            clean_tasks = []
            seen_tasks: set = set()
            for ti, t in enumerate(tasks):
                res = validate_task(t)
                if not res["ok"]:
                    errors.extend("%s, task %d: %s" % (l_at, ti + 1, e) for e in res["errors"])
                    continue
                warnings.extend("%s, task %d: %s" % (l_at, ti + 1, w) for w in res["warnings"])
                tid = _s((t or {}).get("id") if isinstance(t, dict) else "") or ("t%d" % (ti + 1))
                if tid in seen_tasks:
                    errors.append('%s: duplicate task id "%s"' % (l_at, tid)); continue
                seen_tasks.add(tid)
                stats["tasks"] += 1
                clean_tasks.append(res["value"])
            try:
                page: Optional[int] = int(l.get("page"))
            except (TypeError, ValueError):
                page = None
            lesson_out = {"id": lid, "title": _s(l.get("title")), "tasks": clean_tasks}
            if page is not None:
                lesson_out["page"] = page
            clean_lessons.append(lesson_out)
        stats["lessons"] += len(clean_lessons)
        clean_units.append({"id": uid, "title": _s(u.get("title")), "lessons": clean_lessons})
    stats["units"] = len(clean_units)
    value = {"format": 1, "units": clean_units}
    return {"ok": not errors, "errors": errors, "warnings": warnings, "stats": stats, "value": value}


def validate_manifest(m: Any) -> dict:
    errors: list[str] = []
    if not isinstance(m, dict):
        return {"ok": False, "errors": ["manifest must be a JSON object"], "value": None}
    if not _s(m.get("title")):
        errors.append('manifest: "title" is required')
    books = {}
    for slot in ("student", "workbook"):
        label = m.get(slot)
        if isinstance(label, str) and label.strip():
            books[slot] = label.strip()
        elif label is True:
            books[slot] = "Student's Book" if slot == "student" else "Workbook"
    if not books:
        errors.append('manifest: declare at least one book ("student" or "workbook")')
    mid = _s(m.get("id")) or slugify(_s(m.get("title")) or "my-book")
    color = _s(m.get("color"))
    value = {
        "format": 1,
        "id": mid,
        "title": _s(m.get("title")) or mid,
        "color": color if _re.match(r"^#[0-9a-fA-F]{6}$", color) else "#6366f1",
        "icon": _s(m.get("icon")) or "📕",
    }
    for key in ("subtitle", "level", "publisher", "description", "author", "created"):
        v = _s(m.get(key))
        if v:
            value[key] = v
    # passport fields must survive validation — otherwise an installed course
    # loses its packageId/revision/fingerprint and every re-sync installs a
    # brand-new copy instead of recognising the existing one.
    pid = _s(m.get("packageId"))
    if pid:
        value["packageId"] = pid
    try:
        rev = int(m.get("revision") or 1)
    except (TypeError, ValueError):
        rev = 1
    if pid:
        value["revision"] = max(1, rev)
    fp = _s(m.get("fingerprint"))
    if fp:
        value["fingerprint"] = fp
    if isinstance(m.get("contributors"), list) and m["contributors"]:
        value["contributors"] = m["contributors"][:20]
    if m.get("localModified") is True:
        value["localModified"] = True
    src = _s(m.get("source"))
    if src:
        value["source"] = src  # "shared" marks hub-installed courses (admin cleanup)
    if not value.get("created"):
        value["created"] = __import__("datetime").date.today().isoformat()
    value.update(books)
    return {"ok": not errors, "errors": errors, "value": value}


_CYR = {"а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z",
        "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
        "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh",
        "щ": "sch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya"}


def slugify(text: str) -> str:
    s = str(text or "").lower()
    s = "".join(_CYR.get(ch, ch if ord(ch) < 128 else "") for ch in s)
    s = _re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:40]
    return s or "x"


def safe_asset_name(rel: str) -> Optional[str]:
    """Normalise an uploaded asset path; reject anything escaping the folder."""
    rel = str(rel or "").replace("\\", "/").lstrip("/")
    parts = [p for p in rel.split("/") if p not in ("", ".", "..")]
    if not parts or len(parts) > 4:
        return None
    cleaned = []
    for p in parts:
        p = _re.sub(r"[^\w.\-\u0400-\u04FF ]+", "_", p, flags=_re.UNICODE).strip(" .")
        if not p:
            return None
        cleaned.append(p)
    return "/".join(cleaned)


MAX_ASSET_BYTES = 40 * 1024 * 1024      # 40 MB per file
MAX_BODY_BYTES = 512 * 1024 * 1024      # 512 MB per request (bulk textbook import)


def unique_folder(base: str, base_dir: Optional[str] = None) -> str:
    """<base_dir>/<base> with a numeric suffix if the name is taken."""
    root_dir = base_dir or TEXTBOOKS_DIR
    os.makedirs(root_dir, exist_ok=True)
    folder = os.path.join(root_dir, base)
    if not os.path.exists(folder):
        return folder
    n = 2
    while os.path.exists(os.path.join(root_dir, "%s-%d" % (base, n))):
        n += 1
    return os.path.join(root_dir, "%s-%d" % (base, n))


def build_pack(manifest: dict, books: dict, assets: Optional[dict] = None) -> dict:
    """Assemble a self-contained .iebpack.json (manifest + books + media).

    Every pack carries a *passport*: packageId (stable across versions),
    revision (bumped on every re-export of the same course) and fingerprint
    (deterministic hash of the content).  Importers use these three fields to
    recognise updates instead of creating duplicate copies."""
    import datetime
    manifest = manifest or {}
    return {
        "format": "ieb-pack",
        "version": 1,
        "exported": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "generator": "IntExeBook",
        "packageId": manifest.get("packageId") or new_package_id(),
        "revision": int(manifest.get("revision") or 1),
        "fingerprint": pack_fingerprint(manifest, books, assets),
        "manifest": manifest,
        "books": books,
        "assets": assets or {},
    }


def new_package_id() -> str:
    import uuid
    return "pkg-" + uuid.uuid4().hex[:16]


def _canonical(value: Any) -> str:
    """Deterministic JSON-ish serialisation: sorted keys, no whitespace."""
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + _canonical(value[k])
                               for k in sorted(value)) + "}"
    if isinstance(value, list):
        return "[" + ",".join(_canonical(v) for v in value) + "]"
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def pack_fingerprint(manifest: dict, books: dict, assets: Optional[dict] = None) -> str:
    core = {
        "title": (manifest or {}).get("title", ""),
        "author": (manifest or {}).get("author", ""),
        "level": (manifest or {}).get("level", ""),
        "units": books or {},
        "media": sorted((assets or {}).keys()),
    }
    return hashlib.sha256(_canonical(core).encode("utf-8")).hexdigest()[:16]


def read_pack(pack: dict) -> dict:
    """Validate a shared pack and extract its passport fields."""
    if not isinstance(pack, dict) or pack.get("format") != "ieb-pack":
        raise TextbookError("this is not an IntExeBook exercise pack (.iebpack.json)")
    manifest = pack.get("manifest") or {}
    books = pack.get("books") or {}
    assets = pack.get("assets") or {}
    return {
        "packageId": pack.get("packageId") or manifest.get("packageId") or "",
        "revision": int(pack.get("revision") or manifest.get("revision") or 1),
        "fingerprint": pack.get("fingerprint") or pack_fingerprint(manifest, books, assets),
        "manifest": manifest, "books": books, "assets": assets,
    }


def iter_textbook_folders() -> list[str]:
    """All textbook folders (and extracted archives) under TEXTBOOKS_DIR and
    SHARED_DIR — used by passport lookups so a course can be found wherever
    it lives (library or shared hub)."""
    out: list[str] = []
    for base in (TEXTBOOKS_DIR, SHARED_DIR):
        if not os.path.isdir(base):
            continue
        for entry in sorted(os.listdir(base)):
            if entry.startswith("_") or entry.startswith("."):
                continue
            full = os.path.join(base, entry)
            if os.path.isdir(full):
                out.append(full)
            elif entry.lower().endswith((".zip", ".tar", ".tar.gz", ".tgz")):
                out.append(full)  # archives are resolved lazily via _ensure_folder
    return out


def find_installed_by_package(package_id: str) -> Optional[dict]:
    """Look through installed courses + published ones for a packageId."""
    if not package_id:
        return None
    for folder in iter_textbook_folders():
        try:
            _f, m = get_textbook_meta(os.path.basename(folder))
        except Exception:
            continue
        if m.get("packageId") == package_id:
            return {"folder": os.path.basename(folder), "manifest": m}
    return None


def publish_course(payload: dict) -> dict:
    """Save a finished teacher-made course into shared-exercises/<slug>/ and
    write its one-file share pack <slug>.iebpack.json next to it.

    The result tells the caller where everything landed so the teacher can
    copy either the whole folder or just the single .iebpack.json file.
    """
    mf = validate_manifest(payload.get("manifest"))
    if not mf["ok"]:
        raise TextbookError("; ".join(mf["errors"]))
    manifest = mf["value"]
    books_raw = payload.get("books") or {}
    books: dict = {}
    all_errors: list[str] = []
    for slot in ("student", "workbook"):
        if slot not in books_raw or not books_raw[slot]:
            continue
        vb = validate_book(books_raw[slot])
        all_errors.extend("%s: %s" % (slot, e) for e in vb["errors"])
        books[slot] = vb["value"]
    if all_errors:
        raise TextbookError("; ".join(all_errors[:8]))
    if not books:
        raise TextbookError("nothing to publish — the course has no content")

    slug = slugify(manifest["id"] or manifest["title"]) or "course"

    # ---- anti-duplicate: re-publishing an existing course UPDATES it in
    # place instead of creating a second copy.  The passport (packageId +
    # title) identifies the course; when a hub pack with the same packageId
    # already exists we overwrite that file and bump its revision, so every
    # teacher's next sync sees an UPDATE rather than a duplicate.
    pack_id = str(payload.get("packageId") or manifest.get("packageId") or "")
    prev_hub = None
    hub_card = None
    if pack_id:
        try:
            for cand in list_hub_packs():
                if cand.get("packageId") == pack_id:
                    hub_card = cand
                    prev_hub = read_hub_pack(cand["file"])
                    break
        except Exception:
            prev_hub = None
    if prev_hub is not None:
        # read_hub_pack returns the raw pack; take the base name from the card
        hub_file = str((hub_card or {}).get("file") or "")
        base = (hub_file[:-len(PACK_EXT)] if hub_file.endswith(PACK_EXT)
                else os.path.splitext(hub_file)[0])
        name = (base
                or slugify((prev_hub.get("manifest") or {}).get("title") or slug)
                or "course")
        folder = os.path.join(SHARED_DIR, name)
        try:
            prev_rev = int(prev_hub.get("revision") or 1)
        except (TypeError, ValueError):
            prev_rev = 1
        try:
            manifest["revision"] = max(1, int(manifest.get("revision") or 1), prev_rev) + 1
        except (TypeError, ValueError):
            manifest["revision"] = prev_rev + 1
        manifest["packageId"] = pack_id
    else:
        folder = unique_folder(slug, SHARED_DIR)
        name = os.path.basename(folder)
    manifest["id"] = name
    manifest["source"] = "shared"
    assets = payload.get("assets") or {}

    # full textbook layout inside shared-exercises/<name>/
    write_textbook(folder, manifest, books, assets)
    # a *copy* of every asset also travels inside the pack as data URLs,
    # including files uploaded earlier straight into the course folder
    pack_assets = dict(assets)
    adir = os.path.join(folder, "assets")
    if os.path.isdir(adir):
        for dirpath, _dirs, files in os.walk(adir):
            for fn in files:
                rel = os.path.relpath(os.path.join(dirpath, fn), adir).replace(os.sep, "/")
                if rel in pack_assets:
                    continue
                try:
                    with open(os.path.join(dirpath, fn), "rb") as fh:
                        raw = fh.read()
                    mime = "application/octet-stream"
                    low = fn.lower()
                    for ext, m in ((".mp3", "audio/mpeg"), (".wav", "audio/wav"),
                                   (".ogg", "audio/ogg"), (".m4a", "audio/mp4"),
                                   (".png", "image/png"), (".jpg", "image/jpeg"),
                                   (".jpeg", "image/jpeg"), (".gif", "image/gif"),
                                   (".webp", "image/webp"), (".svg", "image/svg+xml"),
                                   (".mp4", "video/mp4"), (".webm", "video/webm")):
                        if low.endswith(ext):
                            mime = m
                            break
                    import base64
                    pack_assets["assets/" + rel] = "data:%s;base64," % mime + base64.b64encode(raw).decode()
                except OSError:
                    pass

    pack_path = os.path.join(SHARED_DIR, name + PACK_EXT)
    with open(pack_path, "w", encoding="utf-8") as fh:
        json.dump(build_pack(manifest, books, pack_assets), fh, ensure_ascii=False)

    invalidate_cache()
    return {
        "folder": name,
        "id": name,
        "title": manifest["title"],
        "dir": folder,
        "pack_file": pack_path,
        "pack_name": os.path.basename(pack_path),
    }


def write_textbook(folder: str, manifest: dict, books: dict, assets: Optional[dict] = None) -> None:
    """Persist a whole course package on disk (manifest + book JSONs + assets)."""
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
    for slot, data in (books or {}).items():
        if slot not in ("student", "workbook"):
            continue
        with open(os.path.join(folder, slot + ".json"), "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
    for rel, data_url in (assets or {}).items():
        rel = safe_asset_name(str(rel)[7:] if str(rel).startswith("assets/") else rel)
        if not rel:
            continue
        dest = _safe_join(folder, "assets", *rel.split("/"))
        raw = _decode_data_url(data_url)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as fh:
            fh.write(raw)


def _decode_data_url(url: str) -> bytes:
    url = str(url or "").strip()
    m = _re.match(r"^data:([\w./+-]+)?;base64,([\s\S]+)$", url)
    if not m:
        raise TextbookError("asset must be a base64 data URL")
    try:
        raw = base64.b64decode(m.group(2), validate=True)
    except (binascii.Error, ValueError):
        raise TextbookError("asset has invalid base64 data")
    if len(raw) > MAX_ASSET_BYTES:
        raise TextbookError("asset is too large (max 40 MB)")
    return raw


# --------------------------------------------------------------- drafts
def _draft_file(name: str) -> str:
    safe = _re.sub(r"[^\w.\-]", "_", str(name or "draft"), flags=_re.UNICODE)[:80] or "draft"
    return os.path.join(DRAFTS_DIR, safe + ".json")


def save_draft(name: str, payload: dict) -> str:
    os.makedirs(DRAFTS_DIR, exist_ok=True)
    path = _draft_file(name)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
    os.replace(tmp, path)
    return path


def load_draft(name: str) -> Optional[dict]:
    path = _draft_file(name)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def list_drafts() -> list:
    if not os.path.isdir(DRAFTS_DIR):
        return []
    out = []
    for f in sorted(os.listdir(DRAFTS_DIR)):
        if not f.endswith(".json"):
            continue
        try:
            with open(os.path.join(DRAFTS_DIR, f), encoding="utf-8") as fh:
                d = json.load(fh)
        except Exception:
            continue
        out.append({
            "name": f[:-5],
            "title": (d.get("manifest") or {}).get("title") or f[:-5],
            "updated": d.get("updated") or "",
            "tasks": (d.get("stats") or {}).get("tasks"),
        })
    return out


def delete_draft(name: str) -> bool:
    path = _draft_file(name)
    if os.path.isfile(path):
        os.remove(path)
        return True
    return False


# --------------------------------------------------------------- create / edit
def create_textbook(payload: dict) -> dict:
    """Create a brand-new teacher-made course from the editor payload."""
    mf = validate_manifest(payload.get("manifest"))
    if not mf["ok"]:
        raise TextbookError("; ".join(mf["errors"]))
    manifest = mf["value"]
    books_raw = payload.get("books") or {}
    books = {}
    all_errors: list[str] = []
    for slot in ("student", "workbook"):
        if slot not in books_raw or not books_raw[slot]:
            continue
        vb = validate_book(books_raw[slot])
        all_errors.extend("%s: %s" % (slot, e) for e in vb["errors"])
        books[slot] = vb["value"]
    if all_errors:
        raise TextbookError("; ".join(all_errors[:8]))
    if not books:
        raise TextbookError("nothing to save — the course has no content")

    folder = unique_folder(slugify(manifest["id"] or manifest["title"]))
    manifest["id"] = os.path.basename(folder)
    assets = payload.get("assets") or {}
    # stamp the passport fields (packageId/revision/fingerprint) BEFORE the
    # first write — otherwise a course that was published straight to GitHub
    # (no local copy) is invisible to find_installed_by_package() and every
    # later sync installs it as a brand-new duplicate instead of updating.
    for key in ("packageId", "revision", "fingerprint", "authorKey"):
        if payload.get(key) is not None and key not in manifest:
            manifest[key] = payload[key]
    if manifest.get("packageId"):
        try:
            manifest.setdefault("revision", max(1, int(payload.get("revision") or 1)))
        except (TypeError, ValueError):
            manifest.setdefault("revision", 1)
        manifest.setdefault("fingerprint", pack_fingerprint(manifest, books, assets))
    write_textbook(folder, manifest, books, assets)
    invalidate_cache()
    return {"folder": os.path.basename(folder), "id": manifest["id"], "title": manifest["title"]}


def patch_textbook(id_or_folder: str, payload: dict) -> dict:
    """Overwrite manifest and/or book files of an existing course."""
    folder, manifest = get_textbook_meta(id_or_folder)
    # Remember that a synced course was edited locally: the smart-import then
    # chooses MERGE instead of silently overwriting the teacher's changes.
    if (manifest.get("packageId") or "").startswith("pkg-") and not manifest.get("localModified"):
        incoming_mf = payload.get("manifest") or {}
        same_pack = (not incoming_mf.get("packageId")
                     or incoming_mf.get("packageId") == manifest.get("packageId"))
        if same_pack:
            try:
                mf_path = _find_manifest(folder)
                if mf_path:
                    saved = _read_manifest(mf_path)
                    saved["localModified"] = True
                    with open(mf_path, "w", encoding="utf-8") as fh:
                        json.dump(saved, fh, ensure_ascii=False, indent=2)
            except Exception:
                pass
    if payload.get("manifest"):
        mf = validate_manifest(dict(manifest, **payload["manifest"]))
        if not mf["ok"]:
            raise TextbookError("; ".join(mf["errors"]))
        manifest = mf["value"]
        manifest["id"] = manifest.get("id") or os.path.basename(folder)
    books = {}
    errs: list[str] = []
    for slot in ("student", "workbook"):
        if slot in (payload.get("books") or {}):
            vb = validate_book(payload["books"][slot])
            if not vb["ok"]:
                errs.extend("%s: %s" % (slot, e) for e in vb["errors"][:6])
            else:
                books[slot] = vb["value"]
    if errs:
        raise TextbookError("; ".join(errs))
    # a manual edit by the owner marks the course as locally modified: sync
    # will then merge incoming changes instead of overwriting them
    old_fp = _s(manifest.get("fingerprint"))
    full_books = dict(books)
    for slot in ("student", "workbook"):
        if slot not in full_books:
            try:
                full_books[slot] = load_book(folder, manifest, slot)
            except Exception:
                pass
    new_fp = pack_fingerprint(manifest, full_books)
    if old_fp and new_fp != old_fp and manifest.get("packageId"):
        manifest["localModified"] = True
    write_textbook(folder, manifest, books, payload.get("assets") or {})
    invalidate_cache()
    return {"folder": os.path.basename(folder), "id": manifest.get("id"), "title": manifest.get("title")}


def import_pack(pack: dict, new_id: Optional[str] = None) -> dict:
    """Install a shared ".iebpack.json" bundle as a local course.

    Smart-import rules (anti-duplicate / multi-teacher):
      * same packageId + identical fingerprint   -> nothing to do ("skip")
      * same packageId + newer revision          -> UPDATE the existing folder
      * same packageId, both sides changed       -> MERGE task-by-task and bump
        the revision above every contributor's version
      * unknown packageId                        -> install as a new course

    The returned "action" is always one of install/update/merge/skip — never
    the client-side "fork"/"duplicate" words — so sync counters can't be fed
    an unrecognised action and miscount it (bug: everything landed in "added").
    """
    if not isinstance(pack, dict) or pack.get("format") != "ieb-pack":
        raise TextbookError("this is not an IntExeBook exercise pack (.iebpack.json)")
    info = read_pack(pack)
    package_id = info["packageId"]
    existing = find_installed_by_package(package_id) if package_id else None
    if existing:
        folder = existing["folder"]
        cur_mf = existing["manifest"]
        cur_fp = cur_mf.get("fingerprint") or ""
        cur_rev = int(cur_mf.get("revision") or 1)
        if info["fingerprint"] and cur_fp == info["fingerprint"]:
            return {"folder": os.path.basename(folder), "id": cur_mf.get("id"),
                    "title": cur_mf.get("title", ""), "action": "skip",
                    "packageId": package_id}
        try:
            cur_books = {}
            for slot in ("student", "workbook"):
                bpath = os.path.join(folder, slot + ".json")
                if os.path.isfile(bpath):
                    with open(bpath, encoding="utf-8") as fh:
                        cur_books[slot] = json.load(fh)
        except Exception:
            cur_books = {}
        merged_manifest, merged_books, merged_rev = merge_pack_with_local(
            info, {"manifest": cur_mf, "books": cur_books})
        payload = {"manifest": merged_manifest, "books": merged_books, "assets": info["assets"]}
        res = patch_textbook(os.path.basename(folder), payload)
        # store passport fields into the manifest so future imports recognise it
        mf_path = _find_manifest(folder)
        if mf_path:
            saved = _read_manifest(mf_path)
            saved.update({"packageId": package_id, "revision": merged_rev,
                          "fingerprint": merged_manifest.get("fingerprint") or info["fingerprint"],
                          "contributors": merged_manifest.get("contributors", [])})
            with open(mf_path, "w", encoding="utf-8") as fh:
                json.dump(saved, fh, ensure_ascii=False, indent=2)
        invalidate_cache()
        action = "update" if cur_rev <= merged_rev else "merge"
        res.update({"action": action, "packageId": package_id, "revision": merged_rev})
        return res
    # brand-new course
    payload = {"manifest": pack.get("manifest"), "books": pack.get("books"), "assets": pack.get("assets")}
    if new_id:
        payload["manifest"] = dict(payload["manifest"] or {}, id=slugify(new_id))
    # stamp the passport into the manifest so re-imports update instead of copy;
    # source=="shared" also marks the course as hub-installed, which lets the
    # admin panel's "remove from this computer too" (and sync cleanup) delete
    # it — locally authored or bundled courses can never be removed that way.
    payload["manifest"] = dict(payload["manifest"] or {},
                               packageId=package_id, revision=info["revision"],
                               fingerprint=info["fingerprint"], source="shared")
    res = create_textbook(payload)
    res.update({"action": "install", "packageId": package_id, "revision": info["revision"]})
    return res


# ------------------------------------------------------------- hub admin
# ------------------------------------------------------------- app updater
APP_VERSION_FILE = os.path.join(ROOT, "app_version.json")


def read_app_version() -> dict:
    """The locally bundled app version (root app_version.json).

    The self-updater writes the release's app_version.json into the app
    folder too — but that file is also the *remote* manifest while editing
    a release on the hub branch.  To keep the two apart, an installed copy
    carries a private marker field "_installed": only files containing it
    count as the local version.  A plain push of app_version.json to the
    hub therefore never makes every synced teacher look like they already
    installed that release (which used to silence the update dialog).
    """
    try:
        with open(APP_VERSION_FILE, encoding="utf-8") as fh:
            j = json.load(fh)
        if isinstance(j, dict) and j.get("_installed"):
            return j
        # No "_installed" marker means the self-updater never wrote this file.
        # The app still knows its own version from web/index.html
        # (window.IEB_APP_VERSION) — read it from disk so /api/app-version
        # always agrees with the badge in the UI.  Without this, a repo/zip
        # checkout reported the stale fallback below and the update dialog
        # kept re-appearing even after installing the same release.
        idx = os.path.join(ROOT, "web", "index.html")
        mver = None
        try:
            import re as _re
            with open(idx, encoding="utf-8") as fh:
                mm = _re.search(r'IEB_APP_VERSION\s*=\s*"([^"]+)"', fh.read())
                if mm:
                    mver = mm.group(1)
        except Exception:
            pass
        if mver:
            out = {"version": mver}
            if isinstance(j, dict):
                for k in ("changelogVersions", "date"):
                    if k in j:
                        out[k] = j[k]
            return out
    except Exception:
        pass
    return {"version": "1.0.0"}   # fallback for very old installs


INSTALLED_MARK = {"_installed"}  # appended by apply_app_update at install time


def _safe_update_target(rel: str) -> str:
    """Resolve a hub-relative file path inside ROOT, refusing escapes.

    The self-updater runs on the teacher's own machine and may only touch
    the app's own code — never the user's data (textbooks/, shared-exercises/),
    never git metadata, never dotfiles like .gitignore/.env.  Anything that
    falls outside that whitelist is rejected with an explicit error.
    """
    rel = str(rel or "").strip().lstrip("/")
    if not rel or "\x00" in rel:
        raise TextbookError("bad update file name")
    parts = [p for p in rel.split("/") if p]
    if not parts or any(p == ".." for p in parts):
        raise TextbookError("update file escapes the app folder: " + rel)
    top = parts[0]
    if top.startswith(".") or top in USER_DATA_DIRS or top in PROTECTED_NAMES:
        raise TextbookError("updates must not touch %s: "
                            "your courses and settings are protected" % top)
    target = os.path.realpath(os.path.join(ROOT, "/".join(parts)))
    root_real = os.path.realpath(ROOT) + os.sep
    if not (target + os.sep).startswith(root_real) and target != os.path.realpath(ROOT):
        raise TextbookError("update file escapes the app folder: " + rel)
    return target


# Folders that hold the teacher's / students' own content — the updater is
# forbidden to write there even when a release manifest lists such a path.
USER_DATA_DIRS = ("textbooks", "shared-exercises", "shared-textbooks",
                  "drafts", ".app-backup")
PROTECTED_NAMES = ("server.log", "README.md")


def apply_app_update(files: list) -> dict:
    """Self-update: write freshly downloaded app files into the app folder.

    The browser side (web/update.js) downloads the new release's files from
    GitHub; the server validates each path and overwrites only plain files
    (never directories, never symlinks outside the app folder).  The previous
    version of every overwritten file is saved under .app-backup/ so the
    teacher can roll back with POST /api/app-update/rollback.

    Returns {"ok", "written": [rel...], "backup": bool}.
    """
    if not isinstance(files, list) or not files:
        raise TextbookError("no files to install")
    backup_dir = os.path.join(ROOT, ".app-backup")
    written: list = []
    for item in files:
        rel = str((item or {}).get("path") or "")
        content = (item or {}).get("content")
        b64 = bool((item or {}).get("base64"))
        if not isinstance(content, str):
            raise TextbookError("file %s has no content" % rel)
        target = _safe_update_target(rel)
        if os.path.isdir(target):
            raise TextbookError("refusing to overwrite a directory: " + rel)
        if os.path.islink(target):
            raise TextbookError("refusing to write through a symlink: " + rel)
        data = base64.b64decode(content) if b64 else content.encode("utf-8")
        if rel.replace(os.sep, "/") == "app_version.json" and not b64:
            # Mark the installed copy as local (see read_app_version): the
            # same file on the hub branch is the *remote* release manifest.
            try:
                _m = json.loads(data.decode("utf-8"))
                if isinstance(_m, dict):
                    _m["_installed"] = True
                    data = (json.dumps(_m, ensure_ascii=False, indent=2) +
                            "\n").encode("utf-8")
            except Exception:
                pass
        os.makedirs(os.path.dirname(target), exist_ok=True)
        if os.path.isfile(target):
            # keep one pristine copy of every file we are about to replace
            prev = os.path.join(backup_dir, rel.replace(os.sep, "/"))
            os.makedirs(os.path.dirname(prev), exist_ok=True)
            if not os.path.exists(prev):
                shutil.copy2(target, prev)
        with open(target, "wb") as fh:
            fh.write(data)
        written.append(rel)
    invalidate_cache()
    return {"ok": True, "written": written, "backup": os.path.isdir(backup_dir)}


def rollback_app_update() -> dict:
    """Restore the pre-update copies kept in .app-backup/ (then remove them)."""
    backup_dir = os.path.join(ROOT, ".app-backup")
    if not os.path.isdir(backup_dir):
        raise TextbookError("no backup found — nothing to roll back")
    restored: list = []
    for dirpath, _dirnames, filenames in os.walk(backup_dir):
        for fn in filenames:
            src = os.path.join(dirpath, fn)
            rel = os.path.relpath(src, backup_dir)
            target = _safe_update_target(rel)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            shutil.copy2(src, target)
            restored.append(rel.replace(os.sep, "/"))
    shutil.rmtree(backup_dir, ignore_errors=True)
    invalidate_cache()
    return {"ok": True, "restored": restored}


def list_hub_packs() -> list:
    """Every flat .iebpack.json sitting in shared-exercises/ (the course hub).

    Returns lightweight cards for the admin panel — title, level, author,
    passport fields and file size. Broken files are skipped silently so one
    corrupt pack cannot hide the whole hub from its owner.
    """
    out: list = []
    if not os.path.isdir(SHARED_DIR):
        return out
    for entry in sorted(os.listdir(SHARED_DIR)):
        if not entry.endswith(PACK_EXT):
            continue
        path = os.path.join(SHARED_DIR, entry)
        try:
            with open(path, encoding="utf-8") as fh:
                pk = json.load(fh)
            mf = pk.get("manifest") or {}
            books_data = pk.get("books") or {}
            units = (books_data.get("student") or {}).get("units") or \
                    (books_data.get("workbook") or {}).get("units") or []
            tasks = sum(len(l.get("tasks") or [])
                        for u in units for l in (u.get("lessons") or []))
            out.append({
                "file": entry,
                "id": mf.get("id") or entry[: -len(PACK_EXT)],
                "title": mf.get("title") or entry,
                "level": mf.get("level", ""),
                "author": mf.get("author", ""),
                "description": mf.get("description", ""),
                "packageId": pk.get("packageId") or mf.get("packageId") or "",
                "revision": int(pk.get("revision") or mf.get("revision") or 1),
                "slots": [s for s in ("student", "workbook") if books_data.get(s)],
                "units": len(units),
                "tasks": tasks,
                "bytes": os.path.getsize(path),
                "updated": time.strftime("%Y-%m-%d %H:%M",
                                         time.localtime(os.path.getmtime(path))),
            })
        except Exception:
            continue
    return out


def read_hub_pack(fname: str) -> dict:
    """Load one hub pack by file name with strict path checks."""
    base = os.path.basename(str(fname or ""))
    if not base.endswith(PACK_EXT):
        raise TextbookError("not a pack file name")
    path = _safe_join(SHARED_DIR, base)
    if not os.path.isfile(path):
        raise TextbookError("hub pack not found: " + base)
    with open(path, encoding="utf-8") as fh:
        try:
            pk = json.load(fh)
        except Exception:
            raise TextbookError("hub pack is not valid JSON: " + base)
    if not isinstance(pk, dict) or pk.get("format") != "ieb-pack":
        raise TextbookError("this file is not an IntExeBook pack")
    return pk


def delete_hub_pack(fname: str) -> bool:
    """Remove one published course file from the hub (admin panel)."""
    base = os.path.basename(str(fname or ""))
    if not base.endswith(PACK_EXT):
        raise TextbookError("not a pack file name")
    path = _safe_join(SHARED_DIR, base)
    if not os.path.isfile(path):
        return False
    os.remove(path)
    invalidate_cache()
    return True


def remove_installed_course(package_id: str) -> dict:
    """Delete a course previously installed from the shared hub.

    Called when Sync notices that a course we installed earlier is no longer
    published in the hub (the author or the admin panel removed it upstream),
    and by the admin panel's local cleanup. Only folders whose manifest says
    source == "shared" are touched — bundled textbooks and locally created
    courses can never be deleted through this path.
    """
    package_id = str(package_id or "").strip()
    if not package_id or "/" in package_id or "\\" in package_id or package_id.startswith("."):
        raise TextbookError("bad package id")
    removed: list = []
    for base_dir in (TEXTBOOKS_DIR, SHARED_DIR):
        if not os.path.isdir(base_dir):
            continue
        for entry in sorted(os.listdir(base_dir)):
            folder = os.path.join(base_dir, entry)
            if not os.path.isdir(folder) or entry.startswith((".", "_")):
                continue
            try:
                mpath = _find_manifest(folder)
                if not mpath:
                    continue
                mf = _read_manifest(mpath)
            except Exception:
                continue
            if mf.get("packageId") != package_id:
                continue
            if str(mf.get("source", "")) != "shared":
                continue  # safety: only hub-installed copies are removable
            shutil.rmtree(folder, ignore_errors=True)
            removed.append(entry)
    # flat pack leftovers inside shared-exercises/
    flat = os.path.join(SHARED_DIR, package_id + PACK_EXT)
    if os.path.isfile(flat):
        try:
            os.remove(flat)
            removed.append(os.path.basename(flat))
        except OSError:
            pass
    invalidate_cache()
    return {"packageId": package_id, "removed": removed}


def save_hub_pack(fname: str, pack: dict) -> dict:
    """Validate and overwrite an existing hub pack (admin edit flow).

    The edited copy keeps the original passport (packageId / revision) so
    teachers who already installed the course get a normal UPDATE on their
    next sync instead of a duplicate. The stored fingerprint is recomputed
    server-side; readers never trust the value embedded in the file anyway.
    """
    if not isinstance(pack, dict) or pack.get("format") != "ieb-pack":
        raise TextbookError("edited payload is not an IntExeBook pack")
    old = read_hub_pack(fname)
    mf = validate_manifest(pack.get("manifest"))
    if not mf["ok"]:
        raise TextbookError("; ".join(mf["errors"]))
    manifest = mf["value"]
    books_raw = pack.get("books") or {}
    books: dict = {}
    errs: list = []
    for slot in ("student", "workbook"):
        if not books_raw.get(slot):
            continue
        vb = validate_book(books_raw[slot])
        errs.extend("%s: %s" % (slot, e) for e in vb["errors"][:6])
        books[slot] = vb["value"]
    if errs:
        raise TextbookError("; ".join(errs[:8]))
    if not books:
        raise TextbookError("nothing to save — the course has no content")
    # keep the identity of the published course stable
    manifest["packageId"] = (old.get("packageId")
                             or (old.get("manifest") or {}).get("packageId")
                             or manifest.get("packageId") or new_package_id())
    try:
        manifest["revision"] = max(1, int(old.get("revision") or 1))
    except (TypeError, ValueError):
        manifest["revision"] = 1
    assets = pack.get("assets") if isinstance(pack.get("assets"), dict) else (old.get("assets") or {})
    out = {"format": "ieb-pack", "version": 1,
           "generator": "IntExeBook admin panel",
           "exported": __import__("datetime").datetime.now().isoformat(),
           "packageId": manifest["packageId"],
           "revision": manifest["revision"],
           "fingerprint": pack_fingerprint(manifest, books, assets),
           "manifest": manifest, "books": books, "assets": assets}
    base = os.path.basename(str(fname or ""))
    # The hub branch is also where app releases live (app_version.json in the
    # repo root).  Editing a course on the hub must never overwrite that file,
    # so refuse any name that would land on it — before touching the disk.
    if base == os.path.basename(APP_VERSION_FILE):
        raise TextbookError("refusing to save a course over the release manifest")
    path = _safe_join(SHARED_DIR, base)
    if not os.path.isfile(path):
        raise TextbookError("hub pack not found: " + base)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False)
    os.replace(tmp, path)
    invalidate_cache()
    return {"ok": True, "file": base, "packageId": manifest["packageId"],
            "revision": manifest["revision"]}


# ------------------------------------------------------- multi-teacher merge
def _task_fingerprint(task: dict) -> str:
    return hashlib.sha256(_canonical(task).encode("utf-8")).hexdigest()[:16]


def _walk_tasks(book: dict):
    for u in book.get("units") or []:
        for l in u.get("lessons") or []:
            for t in l.get("tasks") or []:
                yield u, l, t


def merge_pack_with_local(incoming: dict, local: dict) -> tuple:
    """Merge two versions of ONE course (same packageId) task-by-task.

    Rules that let several teachers edit the same course independently:
      * tasks only one side changed/added  -> kept from that side
      * both sides edited the SAME task    -> the higher-revision author wins
        the body, but BOTH authors are recorded in the task's contributors
      * revisions are combined: new revision = max(local, incoming) + 1
    Returns (manifest, books, new_revision)."""
    import datetime
    inc_mf = incoming["manifest"] or {}
    loc_mf = local["manifest"] or {}
    inc_books = incoming["books"] or {}
    loc_books = local["books"] or {}
    inc_rev = int(incoming.get("revision") or 1)
    loc_rev = int(loc_mf.get("revision") or 1)
    inc_author = _s(inc_mf.get("author")) or "unknown"
    loc_author = _s(loc_mf.get("author")) or "unknown"

    def _walk_tasks_of(book_dict):
        out = []
        for _slot, b in (book_dict or {}).items():
            if isinstance(b, dict):
                out.extend(list(_walk_tasks(b)))
        return out

    # index local tasks by id
    loc_tasks = {t.get("id"): t for t in _walk_tasks_of(loc_books)}

    merged_books: dict = {}
    conflicts = 0
    for slot in ("student", "workbook"):
        inc_b = inc_books.get(slot)
        loc_b = loc_books.get(slot)
        if not inc_b:
            continue
        if not loc_b:
            merged_books[slot] = inc_b
            continue
        merged = json.loads(json.dumps(inc_b))  # start from the incoming structure
        # append local lessons/tasks that the incoming pack does not know about
        inc_lesson_ids = {l.get("id") for u in merged.get("units") or [] for l in u.get("lessons") or []}
        inc_task_ids = {t.get("id") for _u, _l, t in _walk_tasks(merged)}
        for u in loc_b.get("units") or []:
            target_unit = next((mu for mu in merged.get("units") or [] if mu.get("id") == u.get("id")), None)
            for l in u.get("lessons") or []:
                if l.get("id") not in inc_lesson_ids:
                    (target_unit or (merged.setdefault("units", [{}])[0])
                     .setdefault("lessons", [])).append(l)
                    continue
                for t in l.get("tasks") or []:
                    tid = t.get("id")
                    if tid not in inc_task_ids:
                        # local-only task: keep it
                        tl = next((ml for mu in merged.get("units") or []
                                   for ml in mu.get("lessons") or [] if ml.get("id") == l.get("id")), None)
                        if tl is not None:
                            tl.setdefault("tasks", []).append(t)
                        continue
                    # present on both sides — compare against the stored base
                    base = loc_tasks.get(tid)
                    inc_t = next((it for _iu, _il, it in _walk_tasks(merged) if it.get("id") == tid), None)
                    if inc_t is None:
                        continue
                    inc_changed = _task_fingerprint(inc_t) != _task_fingerprint(base) if base else True
                    loc_changed = base is not None and _task_fingerprint(base) != _task_fingerprint(t)
                    if loc_changed and not inc_changed:
                        # replace incoming task with the locally edited one
                        idx = next((i for i, x in enumerate(_find_owner_lesson(merged, tid)[1].get("tasks") or [])
                                    if x.get("id") == tid), None)
                        if idx is not None:
                            _find_owner_lesson(merged, tid)[1]["tasks"][idx] = t
                        conflicts += 1
                    elif loc_changed and inc_changed:
                        # both edited: higher revision wins, record both authors
                        winner = t if loc_rev > inc_rev else inc_t
                        loser = inc_t if loc_rev > inc_rev else t
                        contribs = sorted(set(
                            (winner.get("contributors") or []) + (loser.get("contributors") or []) +
                            [loc_author, inc_author]))
                        winner["contributors"] = contribs
                        idx = next((i for i, x in enumerate(_find_owner_lesson(merged, tid)[1].get("tasks") or [])
                                    if x.get("id") == tid), None)
                        if idx is not None:
                            _find_owner_lesson(merged, tid)[1]["tasks"][idx] = winner
                        conflicts += 1
        merged_books[slot] = merged

    new_rev = max(inc_rev, loc_rev) + (1 if conflicts or inc_rev == loc_rev else 0)
    contribs = sorted(set((loc_mf.get("contributors") or []) + (inc_mf.get("contributors") or []) +
                          [loc_author, inc_author]))
    manifest = dict(inc_mf)
    manifest["author"] = loc_mf.get("author") or inc_mf.get("author")
    manifest["contributors"] = contribs
    manifest["packageId"] = incoming["packageId"]
    manifest["revision"] = new_rev
    manifest["updated"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    manifest["fingerprint"] = pack_fingerprint(manifest, merged_books, incoming.get("assets") or {})
    return manifest, merged_books, new_rev


def _find_owner_lesson(book: dict, task_id: str):
    for u in book.get("units") or []:
        for l in u.get("lessons") or []:
            for t in l.get("tasks") or []:
                if t.get("id") == task_id:
                    return u, l
    return None, None


# --------------------------------------------------------------- bulk import
# A whole textbook with hundreds of MB of audio/video cannot travel inside a
# JSON body efficiently, so teachers can also upload it as a ZIP archive that
# already has the textbook layout (manifest.json + student/workbook.json +
# assets/).  Binary media files go straight to disk — no base64 inflation.

BULK_ALLOWED_EXTS = (
    ".mp3", ".wav", ".ogg", ".m4a", ".aac",          # audio
    ".mp4", ".webm", ".mov", ".avi", ".mkv",         # video
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",  # images
)


def _safe_zip_member(name: str) -> Optional[str]:
    """Normalise a zip member path; reject traversal / absolute paths."""
    name = str(name or "").replace("\\", "/")
    if name.startswith("/") or ".." in [p for p in name.split("/")]:
        return None
    parts = [p for p in name.split("/") if p not in ("", ".")]
    if not parts or len(parts) > 5:
        return None
    cleaned = []
    for p in parts:
        p = _re.sub(r"[^\w.\-\u0400-\u04FF ]+", "_", p, flags=_re.UNICODE).strip(" .")
        if not p:
            return None
        cleaned.append(p)
    return "/".join(cleaned)


def import_zip_bundle(zip_bytes: bytes, new_id: Optional[str] = None) -> dict:
    """Import a textbook from a ZIP archive (manifest.json + books + assets).

    Returns the same shape as create_textbook(): {folder, id, title, ...}.
    """
    import io
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except (zipfile.BadZipFile, OSError):
        raise TextbookError("the uploaded file is not a valid ZIP archive")

    with zf:
        names = zf.namelist()
        total = sum(i.file_size for i in zf.infolist())
        if total > MAX_BODY_BYTES:
            raise TextbookError("unpacked archive is too large (max 512 MB)")

        # locate manifest at the root or under one top-level folder
        def find_manifest(prefix: str = "") -> Optional[str]:
            for n in names:
                rel = n[len(prefix):] if prefix and n.startswith(prefix) else n
                if rel.lower() in MANIFEST_NAMES:
                    return n
            return None

        top = ""
        mname = find_manifest()
        if mname is None:
            roots = {n.split("/")[0] + "/" for n in names if "/" in n}
            for r in sorted(roots):
                if find_manifest(r):
                    top = r
                    break
            mname = find_manifest(top)
        if mname is None:
            raise TextbookError("manifest.json not found in the archive "
                                "(see textbooks/_TEMPLATE for the layout)")

        try:
            manifest = json.loads(zf.read(mname).decode("utf-8"))
        except Exception as exc:
            raise TextbookError("manifest.json is not valid JSON: %s" % exc)
        vm = validate_manifest(manifest)
        if not vm["ok"]:
            raise TextbookError("; ".join(vm["errors"]))
        manifest = vm["value"]

        books: dict = {}
        errors: list[str] = []
        for slot in ("student", "workbook"):
            cand = None
            for n in names:
                rel = n[len(top):] if top else n
                if rel == slot + ".json":
                    cand = n
                    break
            if not cand:
                continue
            try:
                data = json.loads(zf.read(cand).decode("utf-8"))
            except Exception as exc:
                errors.append("%s.json: invalid JSON (%s)" % (slot, exc))
                continue
            vb = validate_book(data)
            errors.extend("%s: %s" % (slot, e) for e in vb["errors"])
            books[slot] = vb["value"]
        if errors:
            raise TextbookError("; ".join(errors[:8]))
        if not books:
            raise TextbookError("no student.json / workbook.json found in the archive")

        # ---- write everything to disk directly (binary-safe, no base64) ----
        if new_id:
            manifest["id"] = slugify(new_id)
        slug = slugify(manifest["id"] or manifest["title"]) or "textbook"
        folder = unique_folder(slug, TEXTBOOKS_DIR)
        name = os.path.basename(folder)
        manifest["id"] = name
        manifest.setdefault("source", "imported")
        os.makedirs(os.path.join(folder, "assets"), exist_ok=True)

        with open(os.path.join(folder, "manifest.json"), "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, ensure_ascii=False, indent=2)
        for slot, data in books.items():
            with open(os.path.join(folder, slot + ".json"), "w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False, indent=2)

        asset_count = 0
        skipped: list[str] = []
        for info in zf.infolist():
            if info.is_dir():
                continue
            rel = info.filename[len(top):] if top else info.filename
            safe = _safe_zip_member(rel)
            if not safe:
                continue
            low = safe.lower()
            if low.endswith(".json"):
                continue  # manifests/books already handled
            if not low.endswith(BULK_ALLOWED_EXTS):
                skipped.append(safe)
                continue
            dest = _safe_join(folder, "assets", *safe.split("/"))
            if os.path.dirname(dest):
                os.makedirs(os.path.dirname(dest), exist_ok=True)
            with zf.open(info) as src, open(dest, "wb") as dst:
                shutil.copyfileobj(src, dst, 1024 * 256)
            asset_count += 1

        invalidate_cache()
        return {
            "folder": name,
            "id": name,
            "title": manifest.get("title", name),
            "assets_imported": asset_count,
            "assets_skipped": skipped[:20],
            "books": list(books.keys()),
        }


# --------------------------------------------------------------------------- #
# public API
# --------------------------------------------------------------------------- #
_scan_cache: Optional[tuple] = None


def invalidate_cache() -> None:
    global _scan_cache
    _scan_cache = None


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
            "icon": manifest.get("icon", ""),
            "author": manifest.get("author", ""),
            "source": manifest.get("source", ""),
            # passport fields must be on the card too — otherwise a course
            # that exists both as an installed folder AND as a flat hub pack
            # is not recognised as the same packageId by the de-duplicator
            # below and appears twice in the library (bug: TEST QWEN GEN
            # showed up as two cards, the broken flat-pack one refused to
            # open).
            "packageId": manifest.get("packageId", ""),
            "revision": manifest.get("revision", 1),
            "books": books,
        })
    # published teacher courses: shared-exercises/<course>/ has the very same
    # layout, so scan it with identical logic and tag the cards source="shared"
    for entry in sorted(os.listdir(SHARED_DIR)) if os.path.isdir(SHARED_DIR) else []:
        if entry.startswith("."):
            continue
        try:
            folder = _ensure_folder_for(SHARED_DIR, entry)
            if not folder:
                continue
            mpath = _find_manifest(folder)
            if not mpath:
                continue
            manifest = _read_manifest(mpath)
        except Exception as exc:
            cards.append({"folder": entry, "id": entry, "title": entry,
                          "error": str(exc), "source": "shared"})
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
            "icon": manifest.get("icon", ""),
            "author": manifest.get("author", ""),
            "source": manifest.get("source", "") or "shared",
            "books": books,
        })
    # flat shared packs that live straight in shared-exercises/*.iebpack.json
    # (the one-file format teachers send each other / sync via GitHub). They
    # are not folders, so scan them as pack cards too.
    if os.path.isdir(SHARED_DIR):
        for entry in sorted(os.listdir(SHARED_DIR)):
            if not entry.endswith(PACK_EXT):
                continue
            try:
                with open(os.path.join(SHARED_DIR, entry), encoding="utf-8") as fh:
                    pk = json.load(fh)
                mf = pk.get("manifest") or {}
                books_data = pk.get("books") or {}
                books = [{"slot": s, "label": mf.get(s) or lbl}
                         for s, lbl in (("student", "Student's Book"), ("workbook", "Workbook"))
                         if books_data.get(s)]
                # compute our OWN fingerprint over the pack content — never
                # trust the one stored inside the file. The client-side and
                # server-side hash algorithms differ, so trusting the embedded
                # value made every sync re-download even your own course.
                fp = pack_fingerprint(mf, books_data, pk.get("assets") or {})
                cards.append({
                    "folder": entry, "id": mf.get("id") or entry[: -len(PACK_EXT)],
                    "title": mf.get("title") or entry,
                    "level": mf.get("level", ""),
                    "description": mf.get("description", ""),
                    "cover": mf.get("cover", ""), "publisher": mf.get("publisher", ""),
                    "icon": mf.get("icon", ""), "author": mf.get("author", ""),
                    "source": "shared-pack",
                    "packageId": pk.get("packageId"),
                    "revision": pk.get("revision", 1),
                    "fingerprint": fp,
                    "books": books,
                })
            except Exception:
                continue  # a broken pack must not break the library

    # de-duplicate: same packageId counts as ONE course even if it exists as
    # both a folder and a flat .iebpack.json file (anti-copy guarantee)
    seen: set[str] = set()
    by_package: dict[str, dict] = {}
    unique = []
    for c in cards:
        pid = c.get("packageId")
        if pid:
            prev = by_package.get(pid)
            if prev is None:
                by_package[pid] = c
                unique.append(c)
            else:
                # prefer richer card (a real folder over a flat pack)
                if prev.get("source") == "shared-pack" and c.get("source") != "shared-pack":
                    unique[unique.index(prev)] = c
                    by_package[pid] = c
            continue
        key = c.get("id") or c.get("folder")
        if key in seen:
            continue
        seen.add(key)
        unique.append(c)
    return unique


def installed_packs() -> list[dict]:
    """Passport view of everything already on this machine — used by the
    client-side smart-import/sync to decide install/update/merge/skip.

    Exactly ONE entry per packageId (the richest fingerprint wins), otherwise
    a course that exists both as an installed folder and as a flat pack in
    shared-exercises/ would report twice and confuse the decision logic."""
    out: dict[str, dict] = {}
    try:
        for c in scan_textbooks():
            mf: dict = {}
            try:
                folder, mf = get_textbook_meta(c.get("folder") or c.get("id") or "")
            except Exception:
                mf = {}
            pkg = c.get("packageId") or mf.get("packageId")
            if not pkg:
                continue
            # for flat shared packs the card already carries a freshly
            # computed fingerprint; for installed folders prefer the stored
            # manifest one, falling back to recomputation from disk content
            fp = c.get("fingerprint") or mf.get("fingerprint") or ""
            if not fp and c.get("source") != "shared-pack":
                try:
                    folder_path = os.path.join(TEXTBOOKS_DIR, c.get("folder") or "")
                    books_now = {}
                    for slot in ("student", "workbook"):
                        bpath = os.path.join(folder_path, slot + ".json")
                        if os.path.isfile(bpath):
                            with open(bpath, encoding="utf-8") as fh:
                                books_now[slot] = json.load(fh)
                    assets_now = {}
                    adir = os.path.join(folder_path, "assets")
                    if os.path.isdir(adir):
                        for fn in os.listdir(adir):
                            assets_now[fn] = True
                    fp = pack_fingerprint(mf, books_now, assets_now)
                except Exception:
                    fp = ""
            rev = int(mf.get("revision") or c.get("revision") or 1)
            entry = {
                "packageId": pkg,
                "revision": rev,
                "fingerprint": fp,
                "title": c.get("title", ""),
                "localModified": bool(mf.get("localModified")),
            }
            prev = out.get(pkg)
            # keep the entry with a real fingerprint / higher revision
            if prev is None or (not prev["fingerprint"] and fp) or rev > prev["revision"]:
                out[pkg] = entry
    except Exception:
        pass
    return list(out.values())


def _ensure_folder_for(base_dir: str, entry: str) -> Optional[str]:
    """_ensure_folder but rooted at an arbitrary directory (shared-exercises)."""
    folder = os.path.join(base_dir, entry)
    if os.path.isdir(folder) and _find_manifest(folder):
        return folder
    if os.path.isfile(folder) and entry.lower().endswith(ARCHIVE_EXTS):
        target = os.path.join(base_dir, _folder_for_archive(entry))
        if not os.path.isdir(target):
            _unpack_into(folder, target)
        return target if _find_manifest(target) else None
    return None


def _pack_card_folder(entry: str) -> Optional[str]:
    """A flat shared pack (``shared-exercises/<name>.iebpack.json``) behaves
    like a virtual course folder named ``<name>`` (the ``.iebpack.json``
    suffix stripped).  If such a pack exists, materialise it into the
    textbooks library exactly once (install_pack stamps the passport, so a
    re-sync later recognises the folder and skips/updates instead of
    duplicating) and return the resulting folder name.  This is what fixes
    'TEST QWEN GEN does not open': hub packs used to appear in the library
    as cards whose folder was only the raw .iebpack.json file, which no
    loader could open."""
    if not entry.endswith(PACK_EXT):
        return None
    base = entry[: -len(PACK_EXT)]
    # an already-materialised course folder (or any folder sharing the id)
    # wins — no need to import anything
    if os.path.isdir(os.path.join(TEXTBOOKS_DIR, base)) and \
            _find_manifest(os.path.join(TEXTBOOKS_DIR, base)):
        return base
    try:
        with open(os.path.join(SHARED_DIR, entry), encoding="utf-8") as fh:
            pk = json.load(fh)
        res = import_pack(pk)
        return res.get("folder") or base
    except Exception:
        return None


def get_textbook_meta(folder_or_id: str) -> tuple[str, dict]:
    """Resolve a folder-name or textbook id -> (folder, manifest)."""
    os.makedirs(TEXTBOOKS_DIR, exist_ok=True)
    # virtual folder backed by a flat hub pack -> materialise on first open.
    # Only when the name is definitely NOT an existing course already; and we
    # never fall back to slug-guessing (that could import an unrelated pack).
    if folder_or_id.endswith(PACK_EXT) and not os.path.isdir(
            os.path.join(TEXTBOOKS_DIR, folder_or_id[: -len(PACK_EXT)])):
        virt = _pack_card_folder(folder_or_id)
        if virt:
            folder_or_id = virt
            cand2 = os.path.join(TEXTBOOKS_DIR, folder_or_id)
            if os.path.isdir(cand2) and _find_manifest(cand2):
                return cand2, _read_manifest(_find_manifest(cand2))  # type: ignore
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
    # published teacher courses in shared-exercises/ resolve the same way
    if os.path.isdir(SHARED_DIR):
        cand = os.path.join(SHARED_DIR, folder_or_id)
        if os.path.isdir(cand) and _find_manifest(cand):
            return cand, _read_manifest(_find_manifest(cand))  # type: ignore
        for entry in sorted(os.listdir(SHARED_DIR)):
            if entry.startswith("."):
                continue
            folder = _ensure_folder_for(SHARED_DIR, entry)
            if not folder:
                continue
            mpath = _find_manifest(folder)
            if not mpath:
                continue
            manifest = _read_manifest(mpath)
            if (manifest.get("id") or os.path.basename(folder)) == folder_or_id:
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
    "word-order": "🧩", "matching": "🔗", "choose-odd-one-out": "🎯",
    "find-and-click": "🔍", "click-on-picture": "🖱️", "word-search": "🔠",
    "translate-match": "🌍",
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
