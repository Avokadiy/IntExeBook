/* ============================================================
   IntExeBook – server core (pure Node.js, no dependencies)

   Mirrors the Python reference implementation in server/:
   modular textbook scanning (folders + zip/tar archives),
   JSON API and static file serving.  Runs inside Electron
   (the desktop app) – nothing needs to be installed by the user.
   ============================================================ */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const WEB_DIR = path.join(ROOT, "web");
const TEXTBOOKS_DIR = process.env.IEB_TEXTBOOKS || path.join(ROOT, "textbooks");
const ARCHIVE_EXTS = [".zip", ".tar.gz", ".tgz"];
const IGNORE_PREFIXES = [".", "_"];

/* ------------------------------------------------------------ util */
class TextbookError extends Error {}

function stripExt(name) {
  const lower = name.toLowerCase();
  for (const ext of [...ARCHIVE_EXTS].sort((a, b) => b.length - a.length)) {
    if (lower.endsWith(ext)) return name.slice(0, -ext.length);
  }
  return name;
}

function safeJoin(base, ...parts) {
  const dest = path.resolve(base, ...parts);
  const baseR = path.resolve(base);
  if (dest !== baseR && !dest.startsWith(baseR + path.sep)) {
    throw new TextbookError("Unsafe path: " + dest);
  }
  return dest;
}

function findManifest(folder) {
  for (const name of ["manifest.json", "manifest.yaml", "manifest.yml"]) {
    const p = path.join(folder, name);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readManifest(file) {
  if (file.endsWith(".json")) return readJson(file);
  throw new TextbookError("YAML manifests are not supported by the built-in engine. Use manifest.json.");
}

/* ------------------------------------------------------------ zip reader */

/* Many archivers (WinRAR and others on Windows) store file names encoded in
   UTF-8 but forget to set the "UTF-8 name" flag bit, so a naive reader decodes
   them as CP437 and ends up with mojibake like "Ð£Ñ‡ÐµÐ±Ð½Ð¸Ðº".  We keep the raw
   bytes of every name and try to recover proper UTF-8 when it is plausible. */
const CP437_REV = {};
(() => {
  const table = [
    [0x80, 0xC7], [0x81, 0xFC], [0x82, 0xE9], [0x83, 0xE2], [0x84, 0xE4], [0x85, 0xE0], [0x86, 0xE5], [0x87, 0xE7],
    [0x88, 0xEA], [0x89, 0xEB], [0x8A, 0xE8], [0x8B, 0xEF], [0x8C, 0xEE], [0x8D, 0xEC], [0x8E, 0xC4], [0x8F, 0xC5],
    [0x90, 0xC9], [0x91, 0xE6], [0x92, 0xC6], [0x93, 0xF4], [0x94, 0xF6], [0x95, 0xF2], [0x96, 0xFB], [0x97, 0xF9],
    [0x98, 0xFF], [0x99, 0xB6], [0x9A, 0xAC], [0x9B, 0xA3], [0x9C, 0xA8], [0x9D, 0xA7], [0x9E, 0x398], [0x9F, 0x393],
    [0xA0, 0x39B], [0xA1, 0x3A0], [0xA2, 0x3A3], [0xA3, 0x3A6], [0xA4, 0x3A8], [0xA5, 0x3A7], [0xA6, 0x3A9], [0xA7, 0x3B4],
    [0xA8, 0x3B1], [0xA9, 0x3B2], [0xAA, 0x3B3], [0xAB, 0x3C0], [0xAC, 0x3C3], [0xAD, 0x3C2], [0xAE, 0x3C4], [0xAF, 0x3C6],
    [0xB0, 0x3B5], [0xB1, 0x20AC], [0xB2, 0x3D2], [0xB3, 0xC0], [0xB4, 0xCB], [0xB5, 0xC2], [0xB6, 0xA0], [0xB7, 0xD1],
    [0xB8, 0xCD], [0xB9, 0xCE], [0xBA, 0xCF], [0xBB, 0xA6], [0xBC, 0xCC], [0xBD, 0xD3], [0xBE, 0xDF], [0xBF, 0xD4],
    [0xC0, 0xDA], [0xC1, 0xDB], [0xC2, 0xDC], [0xC3, 0x3DD], [0xC4, 0xE1], [0xC5, 0xED], [0xC6, 0xF1], [0xC7, 0xBD],
    [0xC8, 0x2DA], [0xC9, 0x2C7], [0xCA, 0x220], [0xCB, 0x221], [0xCC, 0x250], [0xCD, 0x251], [0xCE, 0x252], [0xCF, 0x254],
    [0xD0, 0x255], [0xD1, 0x256], [0xD2, 0x257], [0xD3, 0x258], [0xD4, 0x259], [0xD5, 0x25A], [0xD6, 0x25B], [0xD7, 0x25C],
    [0xD8, 0x25D], [0xD9, 0x25E], [0xDA, 0x25F], [0xDB, 0x260], [0xDC, 0x261], [0xDD, 0x262], [0xDE, 0x263], [0xDF, 0x264],
    [0xE0, 0x265], [0xE1, 0x266], [0xE2, 0x267], [0xE3, 0x268], [0xE4, 0x269], [0xE5, 0x26A], [0xE6, 0x26B], [0xE7, 0x26C],
    [0xE8, 0x26D], [0xE9, 0x26E], [0xEA, 0x26F], [0xEB, 0x270], [0xEC, 0x271], [0xED, 0x272], [0xEE, 0x273], [0xEF, 0x274],
    [0xF0, 0x275], [0xF1, 0x276], [0xF2, 0x277], [0xF3, 0x278], [0xF4, 0x279], [0xF5, 0x27A], [0xF6, 0x27B], [0xF7, 0x27C],
    [0xF8, 0x27D], [0xF9, 0x27E], [0xFA, 0x27F], [0xFB, 0x280], [0xFC, 0x281], [0xFD, 0x282], [0xFE, 0x283], [0xFF, 0x284],
  ];
  for (const [b, cp] of table) CP437_REV[b] = cp;
})();

function cp437ToUnicode(bytes) {
  let out = "";
  for (const b of bytes) {
    if (b < 0x80) out += String.fromCharCode(b);
    else if (CP437_REV[b] !== undefined) out += String.fromCodePoint(CP437_REV[b]);
    else out += "\uFFFD";
  }
  return out;
}

function utf8DecodeStrict(bytes) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch (e) { return null; }
}

/* Recover a sane name from raw zip bytes following APPNOTE behaviour:
   - flag bit 11 set            -> guaranteed UTF-8
   - valid UTF-8 without ASCII  -> treat as UTF-8 anyway (legacy tools)
   - otherwise                  -> decode as CP437; if that round-trips back
                                   to the same bytes and the result itself is
                                   valid UTF-8, the tool stored UTF-8 bytes
                                   without the flag (the WinRAR case).        */
function decodeZipName(rawBytes, flagBits) {
  if (flagBits & 0x800) return new TextDecoder("utf-8").decode(rawBytes);
  const strict = utf8DecodeStrict(rawBytes);
  if (strict !== null) {
    if (!/^[\x00-\x7F]*$/.test(strict)) return strict; // multi-byte UTF-8 without flag
    return strict;                                    // plain ASCII – no ambiguity
  }
  const viaCp437 = cp437ToUnicode(rawBytes);
  const back = Buffer.from(viaCp437, "latin1");       // re-encode code points <= 0xFF
  if (back.length === rawBytes.length && back.equals(rawBytes)) {
    const recovered = utf8DecodeStrict(Buffer.from(viaCp437, "utf-8"));
    if (recovered !== null) return recovered;
  }
  return viaCp437;
}

const LOC_SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/* Read every entry straight from its local file header (PK\3\4).  This works
   even when the central directory at the end of the archive is damaged or
   missing (a truncated download, an editor that saved over the tail): we can
   still walk the data blobs because each local header stores its own CRC and
   compressed size. */
function parseZipLocals(buf) {
  const entries = [];
  let pos = 0;
  while (pos + 30 <= buf.length) {
    const i = buf.indexOf(LOC_SIG, pos);
    if (i < 0) break;
    pos = i;
    const flagBits = buf.readUInt16LE(i + 6);
    const method = buf.readUInt16LE(i + 8);
    const crc = buf.readUInt32LE(i + 14);
    const compSize = buf.readUInt32LE(i + 18);
    const uncompSize = buf.readUInt32LE(i + 22);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    // a healthy stored (uncompressed) entry has comp == uncomp and a real CRC;
    // if that invariant is broken the "signature" we found is random data.
    if (method === 0 && compSize > 0 && crc !== 0 && uncompSize !== compSize) break;
    const rawName = buf.slice(i + 30, i + 30 + nameLen);
    const name = decodeZipName(rawName, flagBits).replace(/\\/g, "/");
    const start = i + 30 + nameLen + extraLen;
    if (!name || name.includes("..") || start + compSize > buf.length) { pos = i + 4; continue; }
    entries.push({ name, method, headerOffset: i, compSize, uncompSize });
    pos = start + compSize;
    if (flagBits & 0x8) {                     // streamed sizes -> data descriptor
      if (pos + 12 <= buf.length) {
        if (buf.readUInt32LE(pos) === 0x08074b50) pos += 4;
        pos += 12;
      }
    }
  }
  return entries;
}

function zipEntriesFromCentral(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 65557; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const cdOff = buf.readUInt32LE(eocd + 16);
  const cdSize = buf.readUInt32LE(eocd + 12);
  // sanity check: the central directory must sit right before the EOCD; if it
  // doesn't, the tail of the archive was truncated and the CD is unusable.
  if (cdOff + cdSize !== eocd) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let off = cdOff;
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(off + 10);
    const flagBits = buf.readUInt16LE(off + 8);
    const compSize = buf.readUInt32LE(off + 20);
    const uncompSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const rawName = buf.slice(off + 46, off + 46 + nameLen);
    const name = decodeZipName(rawName, flagBits).replace(/\\/g, "/");
    entries.push({ name, method, headerOffset: buf.readUInt32LE(off + 42), compSize, uncompSize });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function makeZipReader(buf, entries) {
  return {
    names() { return entries.map(e => e.name); },
    entry(name) { return entries.find(e => e.name === name); },
    read(e) {
      const ho = e.headerOffset;
      if (buf.readUInt32LE(ho) !== 0x04034b50) throw new TextbookError("Corrupt zip local header.");
      const nameLen = buf.readUInt16LE(ho + 26);
      const extraLen = buf.readUInt16LE(ho + 28);
      const start = ho + 30 + nameLen + extraLen;
      let size = e.compSize;
      if (!size && e.uncompSize != null && e.method === 0) size = e.uncompSize;
      const data = buf.slice(start, start + size);
      if (e.method === 0) return data;
      if (e.method === 8) return zlib.inflateRawSync(data);
      throw new TextbookError("Unsupported zip compression method " + e.method);
    },
  };
}

/* Robust .zip reader: prefer the authoritative central directory, but fall
   back to walking local file headers when it is missing or damaged — that is
   exactly what happens with archives whose tail got truncated. */
function parseZip(buf) {
  const central = zipEntriesFromCentral(buf);
  if (central && central.length) return makeZipReader(buf, central);
  const locals = parseZipLocals(buf);
  if (locals.length) return makeZipReader(buf, locals);
  throw new TextbookError("Not a valid .zip archive (no readable entries).");
}

/* ------------------------------------------------------------ tar reader */
function parseTar(buf) {
  const decoder = new TextDecoder("utf-8");
  const str = (b) => decoder.decode(b).replace(/\0.*$/, "").trim();
  const oct = (b) => {
    const s = str(b).replace(/[^0-7]/g, "");
    return s ? parseInt(s, 8) : 0;
  };
  let off = 0;
  const files = [];
  let longName = null;
  while (off + 512 <= buf.length) {
    const header = buf.slice(off, off + 512);
    if (header.every((x) => x === 0)) break;
    const typeFlag = String.fromCharCode(header[156] || 0x30);
    let size = oct(header.slice(124, 136));
    let name = str(header.slice(0, 100));
    const prefix = str(header.slice(345, 500));
    if (prefix) name = prefix + "/" + name;
    let contentOff = off + 512;
    if (typeFlag === "L") {            // GNU long name
      longName = decoder.decode(buf.slice(contentOff, contentOff + size)).replace(/\0.*$/, "");
      off = contentOff + Math.ceil(size / 512) * 512;
      continue;
    }
    if (longName) { name = longName; longName = null; }
    if (typeFlag === "0" || typeFlag === "\0" || typeFlag === "7") {
      files.push({ name, data: () => buf.slice(contentOff, contentOff + size) });
    }
    off = contentOff + Math.ceil(size / 512) * 512;
  }
  return {
    names() { return files.map(f => f.name); },
    entry(name) { return files.find(f => f.name === name); },
    read(f) { return f.data(); },
  };
}

function openArchive(file) {
  const buf = fs.readFileSync(file);
  const lower = file.toLowerCase();
  try {
    if (lower.endsWith(".zip")) return parseZip(buf);
    const raw = lower.endsWith(".zip") ? buf : zlib.gunzipSync(buf);
    return parseTar(raw);
  } catch (e) {
    if (lower.endsWith(".zip")) throw e;
    return parseTar(buf); // uncompressed .tar fallback
  }
}

/* ------------------------------------------------------------ extraction */
function unpackInto(archive, folder) {
  const zf = openArchive(archive);
  const names = zf.names().filter(n => n && !n.includes("__MACOSX") && !n.startsWith("."));
  const files = names.filter(n => !n.endsWith("/"));
  if (!files.length) throw new TextbookError("Archive is empty: " + path.basename(archive));
  // descend into a single common root folder ("my-book/manifest.json")
  let prefix = "";
  const firstParts = files[0].split("/");
  if (firstParts.length > 1) {
    const root = firstParts[0];
    if (files.every(f => f.startsWith(root + "/"))) prefix = root + "/";
  }
  const rels = files.map(f => f.slice(prefix.length)).filter(Boolean);
  if (!rels.some(r => /^manifest\.(json|ya?ml)$/i.test(r))) {
    throw new TextbookError("Archive '" + path.basename(archive) + "' does not contain a manifest.json file.");
  }
  fs.mkdirSync(folder, { recursive: true });
  for (const rel of rels) {
    const dest = safeJoin(folder, ...rel.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, zf.read(zf.entry(prefix + rel)));
  }
}

function ensureFolder(entry) {
  const full = path.join(TEXTBOOKS_DIR, entry);
  const isArchive = ARCHIVE_EXTS.some(e => entry.toLowerCase().endsWith(e));
  if (isArchive && fs.statSync(full).isFile()) {
    const target = path.join(TEXTBOOKS_DIR, stripExt(entry));
    if (!(fs.existsSync(target) && findManifest(target))) unpackInto(full, target);
    return fs.existsSync(target) && findManifest(target) ? target : null;
  }
  if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
    if (findManifest(full)) return full;
    const inner = fs.readdirSync(full).filter(f => ARCHIVE_EXTS.some(e => f.toLowerCase().endsWith(e))).sort()[0];
    if (inner) {
      unpackInto(path.join(full, inner), full);
      if (findManifest(full)) return full;
    }
    return full;
  }
  return null;
}

/* ------------------------------------------------------------ public API */
function scanTextbooks() {
  fs.mkdirSync(TEXTBOOKS_DIR, { recursive: true });
  const cards = [];
  for (const entry of fs.readdirSync(TEXTBOOKS_DIR).sort()) {
    if (IGNORE_PREFIXES.some(p => entry.startsWith(p))) continue;
    const full = path.join(TEXTBOOKS_DIR, entry);
    const st = fs.existsSync(full) ? fs.statSync(full) : null;
    const isArchive = ARCHIVE_EXTS.some(e => entry.toLowerCase().endsWith(e));
    if (!st || !(st.isDirectory() || (st.isFile() && isArchive))) continue;
    let mpath = null, manifest = null, folderName = entry;
    try {
      const folder = ensureFolder(entry);
      if (!folder) continue;
      mpath = folder && findManifest(folder);
      if (!mpath) continue;
      manifest = readManifest(mpath);
      folderName = path.basename(folder);
    } catch (exc) {
      cards.push({ folder: entry, id: entry, title: entry, error: String(exc.message || exc) });
      continue;
    }
    const books = [];
    for (const slot of ["student", "workbook"]) {
      if (manifest[slot + "_file"] || manifest[slot]) {
        books.push({ slot, label: manifest[slot] || (slot === "student" ? "Student's Book" : "Workbook") });
      }
    }
    cards.push({
      folder: folderName,
      id: manifest.id || folderName,
      title: manifest.title || folderName,
      subtitle: manifest.subtitle || "",
      level: manifest.level || "",
      description: manifest.description || "",
      publisher: manifest.publisher || "",
      cover: manifest.cover || "",
      color: manifest.color || "#6366f1",
      icon: manifest.icon || "📕",
      books,
    });
  }
  const seen = new Set();
  return cards.filter(c => {
    const key = c.id || c.folder;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getTextbookMeta(idOrFolder) {
  const direct = path.join(TEXTBOOKS_DIR, idOrFolder);
  if (fs.existsSync(direct)) {
    const folder = ensureFolder(idOrFolder);
    if (folder) {
      const mp = findManifest(folder);
      if (mp) return { folder, manifest: readManifest(mp) };
    }
  }
  for (const card of scanTextbooks()) {
    if (card.error) continue;
    if (card.id === idOrFolder || card.folder === idOrFolder) {
      const folder = path.join(TEXTBOOKS_DIR, card.folder);
      const mp = findManifest(folder);
      if (mp) return { folder, manifest: readManifest(mp) };
    }
  }
  throw new TextbookError("Textbook not found: " + idOrFolder);
}

function loadBook(folder, manifest, slot) {
  if (slot !== "student" && slot !== "workbook") throw new TextbookError("Unknown book slot: " + slot);
  if (!manifest[slot]) throw new TextbookError("This textbook has no " + slot + " book.");
  const fileName = manifest[slot + "_file"] || slot + ".json";
  const p = safeJoin(folder, fileName);
  if (!fs.existsSync(p)) throw new TextbookError("Content file missing: " + fileName);
  const data = readJson(p);
  data.units = data.units || [];
  data.book_label = typeof manifest[slot] === "string"
    ? manifest[slot] : (slot === "student" ? "Student's Book" : "Workbook");
  data.textbook_title = manifest.title || "";
  return data;
}

function findTask(book, unitId, lessonId, taskId) {
  for (const unit of book.units || []) {
    if (unit.id !== unitId) continue;
    for (const lesson of unit.lessons || []) {
      if (lesson.id !== lessonId) continue;
      for (const task of lesson.tasks || []) {
        if (task.id === taskId) return task;
      }
    }
  }
  throw new TextbookError(`Task not found: ${unitId}/${lessonId}/${taskId}`);
}

/* Resolve a textbook by folder name OR by its manifest "id" (the front-end
   uses ids in the URLs).  Mirrors server/loader.py get_textbook_meta(). */
function resolveTextbook(idOrFolder) {
  const direct = path.join(TEXTBOOKS_DIR, idOrFolder);
  if (fs.existsSync(direct)) {
    const folder = ensureFolder(idOrFolder);
    if (folder) {
      const mp = findManifest(folder);
      if (mp) return { folder, manifest: readManifest(mp) };
    }
  }
  for (const card of scanTextbooks()) {
    if (card.error) continue;
    if (card.id === idOrFolder || card.folder === idOrFolder) {
      const folder = path.join(TEXTBOOKS_DIR, card.folder);
      const mp = findManifest(folder);
      if (mp) return { folder, manifest: readManifest(mp) };
    }
  }
  throw new TextbookError("Textbook not found: " + idOrFolder);
}

/* Load one book (student/workbook) and strip task bodies down to summaries. */
function loadBookTree(idOrFolder, slot) {
  const { folder, manifest } = resolveTextbook(idOrFolder);
  const book = JSON.parse(JSON.stringify(loadBook(folder, manifest, slot)));
  for (const u of book.units) for (const l of u.lessons || []) {
    l.tasks = (l.tasks || []).map(t => ({ id: t.id, title: t.title || "", type: t.type || "" }));
    l.task_count = l.tasks.length;
  }
  return book;
}

/* Quick search across every textbook / unit / lesson / task title. */
const MEDIA_ICONS = { image: "🖼️", audio: "🎧", video: "🎬" };
function taskIcon(t) {
  if (t.type === "media") return MEDIA_ICONS[(t.media || [])[0] && t.media[0].type] || "🎬";
  return TYPE_ICONS[t.type] || "⭐";
}
function searchAll(query) {
  const tokens = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const matches = (text) => {
    const low = String(text || "").toLowerCase();
    return tokens.every(t => low.includes(t));
  };
  const enc = encodeURIComponent;
  const results = [];
  for (const card of scanTextbooks()) {
    if (card.error) continue;
    const tbHash = `#/tb/${enc(card.folder)}`;
    if (matches(card.title) || matches(card.subtitle) || matches(card.level) || matches(card.description)) {
      results.push({ kind: "textbook", icon: card.icon || "📕", title: card.title,
                     subtitle: card.subtitle || card.level || "", hash: tbHash });
    }
    const folder = path.join(TEXTBOOKS_DIR, card.folder);
    const mp = findManifest(folder);
    if (!mp) continue;
    const manifest = readManifest(mp);
    for (const slot of ["student", "workbook"]) {
      if (!manifest[slot]) continue;
      let book;
      try { book = loadBook(folder, manifest, slot); } catch (exc) { continue; }
      const bookLabel = book.book_label || slot;
      for (const unit of book.units || []) {
        const uHash = `${tbHash}/${slot}/${enc(unit.id)}`;
        if (matches(unit.title)) results.push({ kind: "unit", icon: "📚", title: unit.title,
          subtitle: `${card.title} · ${bookLabel}`, hash: uHash });
        for (const lesson of unit.lessons || []) {
          const lHash = `${uHash}/${enc(lesson.id)}`;
          if (matches(lesson.title)) results.push({ kind: "lesson", icon: "📖", title: lesson.title,
            subtitle: `${card.title} · ${unit.title} · ${bookLabel}`, hash: lHash });
          for (const task of lesson.tasks || []) {
            if (matches(task.title)) results.push({ kind: "task",
              icon: taskIcon(task), title: task.title,
              subtitle: `${card.title} · ${lesson.title} · ${bookLabel}`,
              hash: `${lHash}/play/${enc(task.id)}` });
          }
        }
      }
    }
    if (results.length >= 60) break;
  }
  return results.slice(0, 60);
}
const TYPE_ICONS = {
  "multiple-choice": "🔤", "true-false": "☑️", "gap-fill": "✏️",
  "word-order": "🧩", "matching": "🔗",
};

/* Load a single full task object. */
function loadTaskFull(idOrFolder, slot, unitId, lessonId, taskId) {
  const { folder, manifest } = resolveTextbook(idOrFolder);
  const book = loadBook(folder, manifest, slot);
  const task = Object.assign({}, findTask(book, unitId, lessonId, taskId));
  task.book_label = book.book_label;
  task.textbook_title = book.textbook_title;
  return task;
}

/* ------------------------------------------------------------ HTTP server */
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".mp3": "audio/mpeg", ".wav": "audio/wav",
  ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".ico": "image/x-icon",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
};

function sendJson(res, obj, status = 200) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store" });
  res.end(body);
}

function sendFile(res, file, req) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return sendJson(res, { error: "Not found" }, 404);
  }
  const ctype = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
  const size = fs.statSync(file).size;
  const rng = req && req.headers && req.headers.range;
  if (rng && /^bytes=\d*-\d*$/.test(rng)) {
    let [startS, endS] = rng.slice(6).split("-");
    let start = startS === "" ? 0 : parseInt(startS, 10);
    let end = endS === "" || endS === undefined ? size - 1 : Math.min(parseInt(endS, 10), size - 1);
    if (start <= end && start < size) {
      const body = Buffer.alloc(end - start + 1);
      const fd = fs.openSync(file, "r");
      fs.readSync(fd, body, 0, body.length, start);
      fs.closeSync(fd);
      res.writeHead(206, {
        "Content-Type": ctype, "Content-Length": body.length,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes", "Cache-Control": "no-cache",
      });
      return res.end(body);
    }
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    "Content-Type": ctype,
    "Content-Length": body.length, "Cache-Control": "no-cache",
    "Accept-Ranges": "bytes",
  });
  res.end(body);
}

/* Serve a file relative to a textbook folder, accepting either a plain
   relative path ("assets/farm.mp3") or an absolute one (legacy manifests).
   Falls back to the archive inside textbooks/ when the folder was never
   unpacked.  Always answers with Accept-Ranges + real Range support, because
   browsers refuse to play <audio>/<video> from servers that cannot seek. */
function sendTextbookAsset(res, baseDir, relPath, req) {
  let rel = String(relPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const m = rel.match(/^(?:[^/]+\/)?assets\/(.+)$/); // "bookid/assets/x" -> "x"
  if (!m) return sendJson(res, { error: "Bad asset path" }, 400);
  rel = "assets/" + m[1];
  let file;
  try { file = safeJoin(baseDir, rel); }
  catch (e) { return sendJson(res, { error: "Unsafe path" }, 400); }
  if (!(fs.existsSync(file) && fs.statSync(file).isFile())) {
    // assets stored inside an unpackable archive – extract just this member
    const stem = path.join(baseDir, path.basename(baseDir));
    const cands = [stem + ".zip", stem + ".tar.gz", stem + ".tgz", stem + ".tar"];
    for (const arc of cands) {
      if (!fs.existsSync(arc)) continue;
      try {
        const zf = openArchive(arc);
        let e = zf.entry(rel);
        if (!e) {
          const hit = zf.names().find(n => n === rel || n.endsWith("/" + rel));
          if (hit) e = zf.entry(hit);
        }
        if (!e) continue;
        const data = zf.read(e);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, data);
      } catch (err) { continue; }
      break;
    }
  }
  return sendFile(res, file, req);
}

function handle(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === "/" || pathname === "/index.html") return sendFile(res, path.join(WEB_DIR, "index.html"), req);
    if (pathname.startsWith("/static/")) {
      const rel = path.normalize(pathname.slice("/static/".length));
      if (rel.startsWith("..") || path.isAbsolute(rel)) return sendJson(res, { error: "Bad request" }, 400);
      return sendFile(res, path.join(WEB_DIR, rel), req);
    }
    // also serve web/ files by plain relative name so index.html can use the
    // same <link href="style.css"> as in file:// mode
    if (!pathname.slice(1).includes("/")) {
      const direct = path.normalize(pathname.slice(1));
      if (direct && !direct.startsWith("..") && fs.existsSync(path.join(WEB_DIR, direct)) &&
          fs.statSync(path.join(WEB_DIR, direct)).isFile()) {
        return sendFile(res, path.join(WEB_DIR, direct), req);
      }
    }
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length === 2 && parts[0] === "api" && parts[1] === "ping") {
      return sendJson(res, { ok: true, engine: "node" });
    }
    if (parts.join("/") === "api/textbooks") return sendJson(res, { textbooks: scanTextbooks() });
    if (parts.length === 2 && parts[0] === "api" && parts[1] === "search") {
      const q = url.searchParams.get("q") || "";
      return sendJson(res, { results: searchAll(q) });
    }
    if (parts.length === 5 && parts[0] === "api" && parts[1] === "textbooks" && parts[3] === "book") {
      return sendJson(res, loadBookTree(parts[2], parts[4]));
    }
    if (parts.length === 8 && parts[0] === "api" && parts[1] === "textbooks" && parts[3] === "task") {
      const [, , tbId, , slot, unitId, lessonId, taskId] = parts;
      return sendJson(res, loadTaskFull(tbId, slot, unitId, lessonId, taskId));
    }
    if (parts[0] === "assets" && parts.length >= 3) {
      // resolve by folder name first (cheap), otherwise scan the catalogue —
      // URLs carry textbook *ids*, which may differ from the folder name.
      let baseDir = path.join(TEXTBOOKS_DIR, parts[1]);
      if (!fs.existsSync(baseDir)) {
        try { baseDir = resolveTextbook(parts[1]).folder; }
        catch (e) { /* keep the raw path: sendFile answers 404 below */ }
      }
      return sendTextbookAsset(res, baseDir, parts.slice(2).join("/"), req);
    }
    return sendJson(res, { error: "Unknown endpoint" }, 404);
  } catch (exc) {
    const status = exc instanceof TextbookError ? 400 : 500;
    return sendJson(res, { error: String(exc.message || exc) }, status);
  }
}

function start(port = 0) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handle);
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

module.exports = {
  start, handle, scanTextbooks, getTextbookMeta, loadBook, findTask, TEXTBOOKS_DIR,
};
