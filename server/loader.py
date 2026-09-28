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
TEXTBOOKS_DIR = os.environ.get("IEB_TEXTBOOKS") or os.path.join(ROOT, "textbooks")

# where drafts of teacher-made courses are kept (autosave / restore)
DRAFTS_DIR = os.environ.get("IEB_DRAFTS") or os.path.join(TEXTBOOKS_DIR, "_drafts")

MANIFEST_NAMES = ("manifest.json", "manifest.yaml", "manifest.yml")
ARCHIVE_EXTS = (".zip", ".tar.gz", ".tgz")
PACK_EXT = ".iebpack.json"

TASK_TYPES = ("multiple-choice", "true-false", "gap-fill", "word-order", "matching")


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
MAX_BODY_BYTES = 64 * 1024 * 1024       # 64 MB per request


def unique_folder(base: str) -> str:
    """textbooks/<base> with a numeric suffix if the name is taken."""
    os.makedirs(TEXTBOOKS_DIR, exist_ok=True)
    folder = os.path.join(TEXTBOOKS_DIR, base)
    if not os.path.exists(folder):
        return folder
    n = 2
    while os.path.exists(os.path.join(TEXTBOOKS_DIR, "%s-%d" % (base, n))):
        n += 1
    return os.path.join(TEXTBOOKS_DIR, "%s-%d" % (base, n))


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
    write_textbook(folder, manifest, books, assets)
    invalidate_cache()
    return {"folder": os.path.basename(folder), "id": manifest["id"], "title": manifest["title"]}


def patch_textbook(id_or_folder: str, payload: dict) -> dict:
    """Overwrite manifest and/or book files of an existing course."""
    folder, manifest = get_textbook_meta(id_or_folder)
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
    write_textbook(folder, manifest, books, payload.get("assets") or {})
    invalidate_cache()
    return {"folder": os.path.basename(folder), "id": manifest.get("id"), "title": manifest.get("title")}


def import_pack(pack: dict, new_id: Optional[str] = None) -> dict:
    """Install a shared ".iebpack.json" bundle as a new local course."""
    if not isinstance(pack, dict) or pack.get("format") != "ieb-pack":
        raise TextbookError("this is not an IntExeBook exercise pack (.iebpack.json)")
    payload = {"manifest": pack.get("manifest"), "books": pack.get("books"), "assets": pack.get("assets")}
    if new_id:
        payload["manifest"] = dict(payload["manifest"] or {}, id=slugify(new_id))
    return create_textbook(payload)


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
