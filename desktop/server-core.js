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
function parseZip(buf) {
  // locate End Of Central Directory record
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 65557; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new TextbookError("Not a valid .zip archive (missing central directory).");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString("utf8");
    entries.push({ name, method, headerOffset: buf.readUInt32LE(off + 42), compSize });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return {
    names() { return entries.map(e => e.name); },
    entry(name) { return entries.find(e => e.name === name); },
    read(e) {
      const ho = e.headerOffset;
      if (buf.readUInt32LE(ho) !== 0x04034b50) throw new TextbookError("Corrupt zip local header.");
      const nameLen = buf.readUInt16LE(ho + 26);
      const extraLen = buf.readUInt16LE(ho + 28);
      const start = ho + 30 + nameLen + extraLen;
      const data = buf.slice(start, start + e.compSize);
      if (e.method === 0) return data;
      if (e.method === 8) return zlib.inflateRawSync(data);
      throw new TextbookError("Unsupported zip compression method " + e.method);
    },
  };
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

/* ------------------------------------------------------------ HTTP server */
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".mp3": "audio/mpeg", ".wav": "audio/wav",
  ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".ico": "image/x-icon",
};

function sendJson(res, obj, status = 200) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store" });
  res.end(body);
}

function sendFile(res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return sendJson(res, { error: "Not found" }, 404);
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
    "Content-Length": body.length, "Cache-Control": "no-cache",
  });
  res.end(body);
}

function handle(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === "/" || pathname === "/index.html") return sendFile(res, path.join(WEB_DIR, "index.html"));
    if (pathname.startsWith("/static/")) {
      const rel = path.normalize(pathname.slice("/static/".length));
      if (rel.startsWith("..") || path.isAbsolute(rel)) return sendJson(res, { error: "Bad request" }, 400);
      return sendFile(res, path.join(WEB_DIR, rel));
    }
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length === 2 && parts[0] === "api" && parts[1] === "ping") {
      return sendJson(res, { ok: true, engine: "node" });
    }
    if (parts.join("/") === "api/textbooks") return sendJson(res, { textbooks: scanTextbooks() });
    if (parts.length === 5 && parts[0] === "api" && parts[1] === "textbooks" && parts[3] === "book") {
      const { folder, manifest } = getTextbookMeta(parts[2]);
      const book = JSON.parse(JSON.stringify(loadBook(folder, manifest, parts[4])));
      for (const u of book.units) for (const l of u.lessons || []) {
        l.tasks = (l.tasks || []).map(t => ({ id: t.id, title: t.title || "", type: t.type || "" }));
        l.task_count = l.tasks.length;
      }
      return sendJson(res, book);
    }
    if (parts.length === 8 && parts[0] === "api" && parts[1] === "textbooks" && parts[3] === "task") {
      const [, , tbId, , slot, unitId, lessonId, taskId] = parts;
      const { folder, manifest } = getTextbookMeta(tbId);
      const book = loadBook(folder, manifest, slot);
      const task = Object.assign({}, findTask(book, unitId, lessonId, taskId));
      task.book_label = book.book_label;
      task.textbook_title = book.textbook_title;
      return sendJson(res, task);
    }
    if (parts[0] === "assets" && parts.length >= 3) {
      const { folder } = getTextbookMeta(parts[1]);
      return sendFile(res, safeJoin(folder, "assets", ...parts.slice(2)));
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
