/* ============================================================
   IntExeBook — shared content schema (browser + Node, UMD)

   Single source of truth for:
     * the textbook JSON format (manifest / student.json / workbook.json)
     * task validation used by BOTH the web authoring editor and the
       local backends (server/loader.py mirrors these rules in Python)

   Loaded in the browser as <script src="shared.js">  -> window.IEB_SHARED
   Loaded in Node via require("./web/shared.js")      -> module.exports
   ============================================================ */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IEB_SHARED = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var FORMAT_VERSION = 1;

  var TASK_TYPES = [
    { type: "multiple-choice", icon: "🔤", label: "Multiple choice", hint: "One correct option among several." },
    { type: "true-false", icon: "☑️", label: "True / False", hint: "A statement the student judges." },
    { type: "gap-fill", icon: "✏️", label: "Gap fill", hint: "Text with blanks (___) to type into." },
    { type: "word-order", icon: "🧩", label: "Word order", hint: "Rebuild a sentence from shuffled words." },
    { type: "matching", icon: "🔗", label: "Matching", hint: "Match items from two columns." },
    { type: "choose-odd-one-out", icon: "🎯", label: "Choose the odd ones out", hint: "Tap all options that do NOT belong to one category." },
    { type: "find-and-click", icon: "🔍", label: "Find & click", hint: "Click the required words inside a sentence or text." },
    { type: "click-on-picture", icon: "🖱️", label: "Click on the picture", hint: "Click marked spots on an image (hotspots)." },
    { type: "word-search", icon: "🔠", label: "Word search", hint: "Find hidden words in a letter grid." },
    { type: "translate-match", icon: "🌍", label: "Translate & match", hint: "Two-column matching with a translation twist." }
  ];
  var TYPE_IDS = TASK_TYPES.map(function (t) { return t.type; });

  /* ---------------------------------------------------------- starter data */
  function defaultTask(type) {
    switch (type) {
      case "multiple-choice": return { options: ["", ""], answerIndex: 0 };
      case "true-false": return { answer: true };
      case "gap-fill": return { text: "I ___ a student.", blanks: [{ answers: ["am"] }] };
      case "word-order": return { words: [], answer: "" };
      case "matching": return { pairs: [{ left: "", right: "" }, { left: "", right: "" }] };
      case "choose-odd-one-out": return { options: [{ text: "", isOdd: false }, { text: "", isOdd: false }, { text: "", isOdd: true }], categoryHint: "" };
      case "find-and-click": return { text: "The cat sat on the mat.", targets: ["cat"], mode: "words" };
      case "click-on-picture": return { image: "", hotspots: [] };
      case "word-search": return { words: ["CAT", "DOG"], grid: [], note: "" };
      case "translate-match": return { pairs: [{ left: "", right: "" }, { left: "", right: "" }] };
      default: return {};
    }
  }

  function blankTask(type) {
    var t = { type: type, title: "", instruction: "" };
    Object.assign(t, defaultTask(type));
    return t;
  }

  var MEDIA_ICONS = { image: "🖼️", audio: "🎧", video: "🎬" };

  /* ---------------------------------------------------------- helpers */
  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function norm(s) { return String(s || "").trim().toLowerCase().replace(/\s+/g, " "); }

  /* ---------------------------------------------------------- ids */
  function slugify(text) {
    var map = { "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya" };
    var s = String(text || "").toLowerCase().replace(/[^\x00-\x7F]+/g, function (ch) {
      var out = "";
      for (var i = 0; i < ch.length; i++) out += (map[ch[i]] !== undefined ? map[ch[i]] : "");
      return out;
    });
    s = s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return s || "x";
  }

  function makeId(prefix, seed, taken) {
    var base = prefix + "-" + slugify(seed);
    if (base === prefix + "-x") base = prefix + "-" + Math.random().toString(36).slice(2, 7);
    var id = base, n = 2;
    while (taken && taken.has(id)) id = base + "-" + (n++);
    if (taken) taken.add(id);
    return id;
  }

  /* ---------------------------------------------------------- media */
  function validMedia(list, err) {
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list)) { err("media must be a list"); return []; }
    var out = [];
    list.forEach(function (m, i) {
      var at = "media[" + i + "]";
      if (!isObj(m)) return err(at + " must be an object");
      var type = str(m.type);
      if (["image", "audio", "video"].indexOf(type) < 0) return err(at + ": type must be image, audio or video");
      var src = str(m.src);
      if (!src) return err(at + ": file is missing");
      out.push({ type: type, src: src, caption: str(m.caption) || undefined });
    });
    return out;
  }

  /* ---------------------------------------------------------- task validation */
  /* Returns { ok, errors[], warnings[], value } where value is the cleaned task. */
  function validateTask(raw) {
    var errors = [], warnings = [];
    function err(m) { errors.push(m); }

    if (!isObj(raw)) return { ok: false, errors: ["task must be an object"], warnings: [], value: null };
    var type = str(raw.type);
    if (TYPE_IDS.indexOf(type) < 0) err("unknown task type “" + (type || "?") + "”");

    var title = str(raw.title) || "Untitled task";
    var instruction = str(raw.instruction);
    var out = { id: str(raw.id) || "task", type: type || "multiple-choice", title: title, instruction: instruction };

    var media = validMedia(raw.media, err);
    if (media.length) out.media = media;
    if (raw.explanation !== undefined && str(raw.explanation)) out.explanation = str(raw.explanation);

    if (type === "multiple-choice") {
      var opts = Array.isArray(raw.options) ? raw.options.map(str) : [];
      if (opts.filter(Boolean).length < 2) err("needs at least 2 answer options");
      var ai = parseInt(raw.answerIndex, 10);
      if (!(ai >= 0 && ai < opts.length)) err("no correct option marked");
      out.options = opts;
      out.answerIndex = isNaN(ai) ? -1 : ai;
    } else if (type === "true-false") {
      if (typeof raw.answer !== "boolean") err("answer must be true or false");
      out.answer = !!raw.answer;
    } else if (type === "gap-fill") {
      var text = str(raw.text);
      var nGaps = (text.match(/_{2,}/g) || []).length;
      var blanks = Array.isArray(raw.blanks) ? raw.blanks : [];
      if (!text) err("sentence text is empty");
      if (!nGaps) err("no gaps found — use ___ in the text");
      if (nGaps && blanks.length !== nGaps) err(nGaps + " gap(s) in the text but " + blanks.length + " answer(s) given");
      var cleanBlanks = [];
      blanks.forEach(function (b, i) {
        var ans = isObj(b) ? (Array.isArray(b.answers) ? b.answers : []) : [];
        var list = ans.map(str).filter(Boolean);
        if (!list.length) err("gap " + (i + 1) + " has no accepted answer");
        var hint = isObj(b) ? str(b.hint) : "";
        cleanBlanks.push(hint ? { answers: list, hint: hint } : { answers: list });
      });
      out.text = text;
      out.blanks = cleanBlanks;
    } else if (type === "word-order") {
      var words = Array.isArray(raw.words) ? raw.words.map(str).filter(Boolean) : [];
      var answer = str(raw.answer) || words.join(" ");
      if (words.length < 2) err("needs at least 2 words");
      var wTok = answer.split(/\s+/).filter(Boolean);
      if (wTok.length !== words.length) {
        err("the answer has " + wTok.length + " word(s) but you provided " + words.length + " tiles");
      } else {
        var pool = words.slice().sort(), need = wTok.slice().sort();
        for (var wi = 0; wi < pool.length; wi++) {
          if (norm(pool[wi]) !== norm(need[wi])) { warnings.push("answer uses words that are not in the tile list"); break; }
        }
      }
      out.words = words;
      out.answer = answer;
    } else if (type === "matching") {
      var pairs = Array.isArray(raw.pairs) ? raw.pairs : [];
      if (pairs.length < 2) err("needs at least 2 pairs");
      var seenL = {}, cleanPairs = [];
      pairs.forEach(function (p, i) {
        var l = isObj(p) ? str(p.left) : "", r = isObj(p) ? str(p.right) : "";
        if (!l || !r) err("pair " + (i + 1) + " is incomplete (both sides needed)");
        else if (seenL[norm(l)]) err("duplicate left item “" + l + "”");
        else { seenL[norm(l)] = 1; cleanPairs.push({ left: l, right: r }); }
      });
      out.pairs = cleanPairs;
    } else if (type === "choose-odd-one-out") {
      var ooRaw = Array.isArray(raw.options) ? raw.options : [];
      var oo = [];
      ooRaw.forEach(function (o, i) {
        var text = isObj(o) ? str(o.text) : str(o);
        if (!text) { err("option " + (i + 1) + " is empty"); return; }
        oo.push({ text: text, isOdd: isObj(o) ? !!o.isOdd : false });
      });
      if (oo.length < 3) err("needs at least 3 options");
      var nOdd = oo.filter(function (o) { return o.isOdd; }).length;
      if (!nOdd) err("mark at least one option as “odd one out”");
      if (nOdd >= oo.length) err("keep at least one option that belongs to the category");
      out.options = oo;
      if (str(raw.categoryHint)) out.categoryHint = str(raw.categoryHint);
    } else if (type === "find-and-click") {
      var fcText = str(raw.text);
      if (!fcText) err("the sentence / text is empty");
      var fcTargets = Array.isArray(raw.targets) ? raw.targets.map(str).filter(Boolean) : [];
      if (!fcTargets.length) err("add at least one word the student must click");
      var fcLower = fcText.toLowerCase();
      fcTargets.forEach(function (t) {
        if (fcLower.indexOf(t.toLowerCase()) < 0) warnings.push("target “" + t + "” does not appear in the text");
      });
      out.text = fcText;
      out.targets = fcTargets;
      out.mode = str(raw.mode) || "words";
    } else if (type === "click-on-picture") {
      var cpImg = str(raw.image);
      if (!cpImg) err("attach a picture first (Media tab or the file picker below)");
      var cpSpots = Array.isArray(raw.hotspots) ? raw.hotspots : [];
      var cpClean = [];
      cpSpots.forEach(function (s, i) {
        if (!isObj(s) || !str(s.label)) { err("hotspot " + (i + 1) + " needs a label"); return; }
        var x = parseFloat(s.x), y = parseFloat(s.y);
        if (!(x >= 0 && x <= 100) || !(y >= 0 && y <= 100)) { err("hotspot “" + s.label + "” has coordinates outside the picture (use 0–100 %)"); return; }
        cpClean.push({ label: str(s.label), x: x, y: y, r: Math.max(4, parseFloat(s.r) || 8) });
      });
      if (!cpClean.length) err("add at least one hotspot — click the picture in the preview to place it");
      out.image = cpImg;
      out.hotspots = cpClean;
    } else if (type === "word-search") {
      var wsWords = Array.isArray(raw.words) ? raw.words.map(function (w) { return str(w).toUpperCase().replace(/[^A-ZА-ЯЁ]/g, ""); }).filter(Boolean) : [];
      if (wsWords.length < 2) err("add at least 2 words to hide");
      var wsGrid = Array.isArray(raw.grid) ? raw.grid.map(function (r) { return String(r || "").toUpperCase(); }) : [];
      if (!wsGrid.length) err("generate the grid (press the button below)");
      var wsMax = Math.max.apply(null, wsGrid.map(function (r) { return r.length; }));
      if (wsWords.some(function (w) { return w.length > wsMax; })) err("a word is longer than the grid — regenerate with a bigger size");
      out.words = wsWords;
      out.grid = wsGrid;
      if (str(raw.note)) out.note = str(raw.note);
    } else if (type === "translate-match") {
      var tmPairs = Array.isArray(raw.pairs) ? raw.pairs : [];
      if (tmPairs.length < 2) err("needs at least 2 pairs");
      var tmSeen = {}, tmClean = [];
      tmPairs.forEach(function (p, i) {
        var l = isObj(p) ? str(p.left) : "", r = isObj(p) ? str(p.right) : "";
        if (!l || !r) err("pair " + (i + 1) + " is incomplete (both sides needed)");
        else if (tmSeen[norm(l)]) err("duplicate left item “" + l + "”");
        else { tmSeen[norm(l)] = 1; tmClean.push({ left: l, right: r }); }
      });
      out.pairs = tmClean;
    }

    return { ok: errors.length === 0, errors: errors, warnings: warnings, value: out };
  }

  /* ---------------------------------------------------------- book validation */
  function validateBook(data) {
    var errors = [], warnings = [], stats = { units: 0, lessons: 0, tasks: 0 };
    if (!isObj(data)) return { ok: false, errors: ["content must be a JSON object"], warnings: [], stats: stats, value: null };
    var units = Array.isArray(data.units) ? data.units : null;
    if (!units) return { ok: false, errors: ["missing \"units\" array"], warnings: [], stats: stats, value: null };
    if (!units.length) errors.push("there are no units yet — add at least one");

    var unitIds = {};
    var cleanUnits = [];
    units.forEach(function (u, ui) {
      var uAt = "unit " + (ui + 1);
      if (!isObj(u)) { errors.push(uAt + " must be an object"); return; }
      var uid = str(u.id) || ("u" + (ui + 1));
      if (unitIds[uid]) errors.push(uAt + ": duplicate unit id “" + uid + "”");
      unitIds[uid] = 1;
      if (!str(u.title)) warnings.push(uAt + " (“" + uid + "”) has no title");
      var lessonIds = {};
      var lessons = Array.isArray(u.lessons) ? u.lessons : [];
      if (!lessons.length) warnings.push("unit “" + (str(u.title) || uid) + "” has no lessons");
      var cleanLessons = [];
      lessons.forEach(function (l, li) {
        var lAt = uAt + ", lesson " + (li + 1);
        if (!isObj(l)) { errors.push(lAt + " must be an object"); return; }
        var lid = str(l.id) || ("l" + (li + 1));
        if (lessonIds[lid]) errors.push(lAt + ": duplicate lesson id “" + lid + "”");
        lessonIds[lid] = 1;
        if (!str(l.title)) warnings.push(lAt + " (“" + lid + "”) has no title");
        var taskIds = {};
        var tasks = Array.isArray(l.tasks) ? l.tasks : [];
        if (!tasks.length) warnings.push("lesson “" + (str(l.title) || lid) + "” has no tasks");
        var cleanTasks = [];
        tasks.forEach(function (t, ti) {
          var res = validateTask(t);
          if (!res.ok) {
            res.errors.forEach(function (e) { errors.push(lAt + ", task " + (ti + 1) + ": " + e); });
            return;
          }
          res.warnings.forEach(function (w) { warnings.push(lAt + ", task " + (ti + 1) + ": " + w); });
          var tid = str(t && t.id) || ("t" + (ti + 1));
          if (taskIds[tid]) { errors.push(lAt + ": duplicate task id “" + tid + "”"); return; }
          taskIds[tid] = 1;
          stats.tasks++;
          cleanTasks.push(res.value);
        });
        var page = parseInt(l.page, 10);
        cleanLessons.push({ id: lid, title: str(l.title), page: isNaN(page) ? undefined : page, tasks: cleanTasks });
      });
      stats.lessons += cleanLessons.length;
      cleanUnits.push({ id: uid, title: str(u.title), lessons: cleanLessons });
    });
    stats.units = cleanUnits.length;
    return { ok: errors.length === 0, errors: errors, warnings: warnings, stats: stats,
             value: { format: FORMAT_VERSION, units: cleanUnits } };
  }

  /* ---------------------------------------------------------- manifest */
  function validateManifest(m) {
    var errors = [];
    if (!isObj(m)) return { ok: false, errors: ["manifest must be a JSON object"], value: null };
    if (!str(m.title)) errors.push("manifest: \"title\" is required");
    var books = {};
    ["student", "workbook"].forEach(function (slot) {
      var label = m[slot];
      if (label === undefined || label === null || label === false) return;
      if (typeof label === "string" && label.trim()) books[slot] = label.trim();
      else if (label === true) books[slot] = slot === "student" ? "Student's Book" : "Workbook";
    });
    if (!Object.keys(books).length) errors.push("manifest: declare at least one book (\"student\" or \"workbook\")");
    var id = str(m.id) || slugify(str(m.title) || "my-book");
    var value = {
      format: FORMAT_VERSION,
      id: id,
      title: str(m.title) || id,
      subtitle: str(m.subtitle) || undefined,
      level: str(m.level) || undefined,
      publisher: str(m.publisher) || undefined,
      description: str(m.description) || undefined,
      color: /^#[0-9a-fA-F]{6}$/.test(str(m.color)) ? str(m.color) : "#6366f1",
      icon: str(m.icon) || "📕",
      author: str(m.author) || undefined,
      created: str(m.created) || new Date().toISOString().slice(0, 10),
      student: books.student,
      workbook: books.workbook
    };
    return { ok: errors.length === 0, errors: errors, value: value };
  }

  /* ---------------------------------------------------------- pack format
     A ".iebpack.json" file bundles everything needed to hand a course to
     another teacher: manifest + both books + assets encoded as data URLs.  */
  /* deterministic content fingerprint: identical content -> identical hash.
     Used to detect re-imports of the same pack (no duplicates) and to tell
     apart a genuine update from an unchanged file. */
  function canonical(value) {
    if (value === null || value === undefined) return "null";
    if (typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    var keys = Object.keys(value).filter(function (k) { return value[k] !== undefined; }).sort();
    return "{" + keys.map(function (k) { return JSON.stringify(k) + ":" + canonical(value[k]); }).join(",") + "}";
  }
  function fnv1a(str) {
    var h = 0x811c9dc5 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    // second round over reversed data widens the digest (16 hex chars)
    var h2 = 0x811c9dc5 >>> 0;
    for (var j = str.length - 1; j >= 0; j--) {
      h2 ^= str.charCodeAt(j);
      h2 = Math.imul(h2, 0x01000193) >>> 0;
    }
    return ("00000000" + h.toString(16)).slice(-8) + ("00000000" + h2.toString(16)).slice(-8);
  }
  function packFingerprint(manifest, books, assets) {
    var assetNames = Object.keys(assets || {}).sort();
    var core = {
      title: (manifest && manifest.title) || "",
      author: (manifest && manifest.author) || "",
      level: (manifest && manifest.level) || "",
      units: books || {},
      media: assetNames
    };
    return fnv1a(canonical(core));
  }

  function buildPack(obj) {
    var manifest = obj.manifest || {};
    var books = obj.books || {};
    var assets = obj.assets || {};
    var pkg = {
      format: "ieb-pack",
      version: FORMAT_VERSION,
      exported: new Date().toISOString(),
      generator: "IntExeBook",
      packageId: manifest.packageId || makePackageId(),
      revision: typeof obj.revision === "number" ? obj.revision : (manifest.revision || 1),
      fingerprint: packFingerprint(manifest, books, assets),
      manifest: manifest,
      books: books,
      assets: assets
    };
    return pkg;
  }

  function makePackageId() {
    var rnd = "";
    try {
      var arr = new Uint8Array(8);
      (self.crypto || window.crypto).getRandomValues(arr);
      rnd = Array.prototype.map.call(arr, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    } catch (e) {
      rnd = Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
    }
    return "pkg-" + rnd;
  }

  function readPack(json) {
    var errors = [];
    if (!isObj(json)) return { ok: false, errors: ["file is not a JSON object"] };
    if (json.format !== "ieb-pack") {
      return { ok: false, errors: ["this is not an IntExeBook exercise pack (.iebpack.json)"] };
    }
    var mf = validateManifest(json.manifest);
    if (!mf.ok) return { ok: false, errors: mf.errors };
    var books = {};
    Object.keys(json.books || {}).forEach(function (slot) {
      if (slot !== "student" && slot !== "workbook") return;
      if (!json.books[slot]) return;
      var vb = validateBook(json.books[slot]);
      if (!vb.ok) { vb.errors.slice(0, 5).forEach(function (e) { errors.push(slot + ": " + e); }); return; }
      books[slot] = vb.value;
    });
    if (!Object.keys(books).length && !errors.length) errors.push("the pack contains no usable book");
    var assets = {};
    Object.keys(json.assets || {}).forEach(function (name) {
      var safe = String(name).replace(/^(\.\.(\/|\\|$))+/g, "").replace(/\\/g, "/").replace(/^\/+/, "");
      if (!safe || /\.\./.test(safe)) return;
      var d = json.assets[name];
      if (typeof d === "string" && /^data:[^;]+;base64,[\s\S]+$/.test(d.replace(/\s/g, ""))) {
        assets["assets/" + safe] = d.replace(/\s/g, "");
      }
    });
    return { ok: errors.length === 0, errors: errors, manifest: mf.value, books: books, assets: assets,
             packageId: json.packageId || (mf.value && mf.value.packageId) || null,
             revision: typeof json.revision === "number" ? json.revision : 1,
             fingerprint: json.fingerprint || packFingerprint(mf.value, books, assets) };
  }

  /* ------------------------------------------------- smart import decision
     Compare an incoming pack against what is already installed. Returns a
     plan the UI shows to the teacher before anything is written:
       install   – brand-new course, safe to add
       duplicate – same content already installed, skip (no copies!)
       update    – same packageId, newer/equal revision -> replace in place
       fork      – same packageId but locally modified -> merge task-by-task */
  function decidePackAction(pack, installed) {
    // installed: [{packageId, revision, fingerprint}]
    var same = null;
    (installed || []).forEach(function (c) {
      if (pack.packageId && c.packageId === pack.packageId) same = c;
    });
    if (!same) {
      for (var i = 0; i < (installed || []).length; i++) {
        var c = installed[i];
        if (pack.fingerprint && c.fingerprint === pack.fingerprint)
          return { action: "duplicate", existing: c, reason: "identical content is already installed" };
      }
      return { action: "install", reason: "new course" };
    }
    if (same.fingerprint && same.fingerprint === pack.fingerprint)
      return { action: "duplicate", existing: same, reason: "this exact version is already installed" };
    if ((pack.revision || 1) >= (same.revision || 1) && !same.localModified)
      return { action: "update", existing: same, reason: "revision " + (same.revision || 1) + " → " + (pack.revision || 1) };
    return { action: "fork", existing: same, reason: "both versions changed — tasks will be merged" };
  }

  /* three-way-ish merge of two books sharing one packageId: keep every task
     from both sides, prefer the newer revision for identical task ids, and
     namespace colliding new ids so nothing is silently lost or duplicated. */
  function mergeBooks(base, incoming, incomingIsNewer) {
    function index(book) {
      var map = {};
      ((book && book.units) || []).forEach(function (u) {
        (u.lessons || []).forEach(function (l) {
          (l.tasks || []).forEach(function (t) { map[t.id] = { unit: u.id, lesson: l.id, task: t }; });
        });
      });
      return map;
    }
    var bIdx = index(base), iIdx = index(incoming);
    var out = JSON.parse(JSON.stringify(base));
    var taken = Object.keys(bIdx);
    var stats = { added: 0, updated: 0, keptLocal: 0, renamed: 0 };
    var lastUnit = out.units[out.units.length - 1];
    ((incoming && incoming.units) || []).forEach(function (u) {
      (u.lessons || []).forEach(function (l) {
        (l.tasks || []).forEach(function (t) {
          var old = iIdx[t.id];
          if (!bIdx[t.id]) {
            // only in the incoming copy -> append into a matching or new lesson
            var target = findLesson(out, u.id, l.id, l.title);
            var clone = JSON.parse(JSON.stringify(t));
            if (taken.indexOf(clone.id) >= 0) { clone.id = "imp-" + Math.random().toString(36).slice(2, 8) + "-" + clone.id; stats.renamed++; }
            target.tasks.push(clone); taken.push(clone.id); stats.added++;
          } else if (incomingIsNewer) {
            bIdx[t.id].task = t; // shared id, newer wins
            replaceTask(out, u.id, l.id, t.id, t);
            stats.updated++;
          } else { stats.keptLocal++; }
        });
      });
    });
    return { value: out, stats: stats };
  }
  function findLesson(book, unitId, lessonId, title) {
    var units = book.units || [];
    var unit = units.filter(function (u) { return u.id === unitId; })[0] || units[units.length - 1];
    if (!unit) { unit = { id: "u-imp-" + Date.now().toString(36), title: "Imported", lessons: [] }; book.units.push(unit); }
    unit.lessons = unit.lessons || [];
    var lesson = unit.lessons.filter(function (l) { return l.id === lessonId; })[0] ||
                 unit.lessons.filter(function (l) { return l.title === title; })[0];
    if (!lesson) { lesson = { id: "l-imp-" + Date.now().toString(36), title: title || "Imported", tasks: [] }; unit.lessons.push(lesson); }
    lesson.tasks = lesson.tasks || [];
    return lesson;
  }
  function replaceTask(book, unitId, lessonId, taskId, fresh) {
    (book.units || []).forEach(function (u) {
      (u.lessons || []).forEach(function (l) {
        (l.tasks || []).forEach(function (t, i) { if (t.id === taskId) l.tasks[i] = fresh; });
      });
    });
  }

  /* ---------------------------------------------------------- starter pack
     Shown on the "Create exercises" page when the teacher has no course
     open yet — a fully working example they can edit immediately.        */
  function starterDraft() {
    return {
      target: { mode: "standalone" },
      manifest: {
        id: "my-course", title: "My first course", subtitle: "", level: "",
        description: "Created with the IntExeBook exercise builder.",
        color: "#6366f1", icon: "✨", author: ""
      },
      slot: "student",
      book: {
        format: FORMAT_VERSION,
        units: [{
          id: "u1", title: "Unit 1 — Warm-up",
          lessons: [{
            id: "l1", title: "Lesson 1 — First tasks", page: null,
            tasks: [
              { id: "t1", type: "multiple-choice", title: "Example: multiple choice",
                instruction: "Choose the correct answer.",
                options: ["apple", "banana"], answerIndex: 1 },
              { id: "t2", type: "true-false", title: "Example: true / false",
                instruction: "The cat can fly.", answer: false, explanation: "Cats cannot fly." },
              { id: "t3", type: "gap-fill", title: "Example: gap fill",
                instruction: "Complete the sentence.", text: "I ___ a teacher.",
                blanks: [{ answers: ["am"], hint: "verb \"to be\"" }] },
              { id: "t4", type: "word-order", title: "Example: word order",
                instruction: "Put the words in order.", words: ["like", "I", "tea"], answer: "I like tea" },
              { id: "t5", type: "matching", title: "Example: matching",
                instruction: "Match the words.",
                pairs: [{ left: "Sun", right: "солнце" }, { left: "Moon", right: "луна" }] }
            ]
          }]
        }]
      }
    };
  }

  /* ---------------------------------------------------------- word-search grid
     Places every word horizontally / vertically / diagonally into a grid,
     fills the rest with random letters. Deterministic enough for authoring;
     returns array of equal-length strings (rows). */
  function generateWordGrid(words, size) {
    var W = Math.max(size || 0, words.reduce(function (m, w) { return Math.max(m, w.length); }, 6));
    var dirs = [[1, 0], [0, 1], [1, 1], [-1, 1]];
    var slots = [];
    for (var y = 0; y < W; y++) for (var x = 0; x < W; x++) slots.push([x, y]);
    // shuffle slots
    for (var i = slots.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = slots[i]; slots[i] = slots[j]; slots[j] = tmp;
    }
    var grid = [];
    for (var r = 0; r < W; r++) { var row = []; for (var c = 0; c < W; c++) row.push(""); grid.push(row); }
    function fits(word, x, y, dx, dy) {
      var cx = x, cy = y;
      for (var k = 0; k < word.length; k++) {
        if (cx < 0 || cy < 0 || cx >= W || cy >= W) return false;
        var cell = grid[cy][cx];
        if (cell !== "" && cell !== word[k]) return false;
        cx += dx; cy += dy;
      }
      return true;
    }
    var placedAll = true;
    words.slice().sort(function (a, b) { return b.length - a.length; }).forEach(function (word) {
      var done = false;
      outer:
      for (var si = 0; si < slots.length; si++) {
        for (var di = 0; di < dirs.length; di++) {
          var d = dirs[di];
          if (fits(word, slots[si][0], slots[si][1], d[0], d[1])) {
            var cx = slots[si][0], cy = slots[si][1];
            for (var k = 0; k < word.length; k++) { grid[cy][cx] = word[k]; cx += d[0]; cy += d[1]; }
            done = true; break outer;
          }
        }
      }
      if (!done) placedAll = false;
    });
    var alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (var ry = 0; ry < W; ry++) for (var rx = 0; rx < W; rx++) {
      if (grid[ry][rx] === "") grid[ry][rx] = alpha[Math.floor(Math.random() * 26)];
    }
    return { ok: placedAll, rows: grid.map(function (row) { return row.join(""); }) };
  }

  /* =====================================================================
   * GITHUB SYNC — the one-button "🔄 Sync" sharing channel (no extra server)
   *
   * The teachers' shared repository IS a GitHub repo (default: the IntExeBook
   * repo itself). Published courses live under shared-exercises/ as flat
   * <packageId>.iebpack.json files (one file per course pack -> two authors
   * can never overwrite each other's files); the app reads them via
   * raw.githubusercontent.com and writes them via the Contents API with a
   * fine-grained PAT.
   * ===================================================================== */

  var SYNC_DEFAULTS = { owner: "Avokadiy", repo: "IntExeBook", branch: "audio-and-dark-theme-5c6ce", folder: "shared-exercises" };

  function syncStorage() {
    /* works in the browser (localStorage) and in Node tests (in-memory) */
    if (typeof localStorage !== "undefined") return localStorage;
    var mem = {};
    return { getItem: function (k) { return mem[k] === undefined ? null : mem[k]; },
             setItem: function (k, v) { mem[k] = String(v); },
             removeItem: function (k) { delete mem[k]; } };
  }

  function syncConfig() {
    try {
      var c = JSON.parse(syncStorage().getItem("ieb-sync-config") || "{}");
      var cfg = {
        owner: c.owner || SYNC_DEFAULTS.owner,
        repo: c.repo || SYNC_DEFAULTS.repo,
        branch: c.branch || SYNC_DEFAULTS.branch,
        folder: c.folder || SYNC_DEFAULTS.folder,
        token: c.token || ""
      };
      /* convenience fallback: the same token the “🔄 Update” button was given
         can also live in localStorage["ieb-github-token"] — Publish/Update
         pick it up automatically so teachers only paste it once */
      if (!cfg.token) {
        try { cfg.token = syncStorage().getItem("ieb-github-token") || ""; } catch (e2) {}
      }
      return cfg;
    } catch (e) { return Object.assign({}, SYNC_DEFAULTS); }
  }

  function saveSyncConfig(cfg) {
    syncStorage().setItem("ieb-sync-config", JSON.stringify(cfg));
  }

  function rawUrl(cfg, path) {
    return "https://raw.githubusercontent.com/" + cfg.owner + "/" + cfg.repo + "/" + cfg.branch + "/" + path;
  }

  function apiBase(cfg) {
    return "https://api.github.com/repos/" + cfg.owner + "/" + cfg.repo;
  }

  async function ghFetch(url, opts) {
    var res = await fetch(url, opts);
    if (!res.ok) {
      var msg = "HTTP " + res.status;
      try { var j = await res.json(); if (j.message) msg += " — " + j.message; } catch (e) {}
      throw new Error(msg);
    }
    return res;
  }

  /* list pack files in the shared folder.
     Robust against every common failure mode so teachers never see a raw
     404:
       * folder missing on GitHub  -> auto-create it via an empty commit
         (needs a token; read-only users just get an empty list);
       * wrong branch name         -> resolve the repo default branch and
         save the fix into the local config;
       * network/token problems    -> fall back to the cached index. */
  async function syncListPacks(cfg) {
    cfg = cfg || syncConfig();
    var cacheKey = "ieb-sync-index";
    var url = function (branch) {
      return apiBase(cfg) + "/contents/" + encodeURIComponent(cfg.folder) + "?ref=" + encodeURIComponent(branch);
    };
    var headers = { Accept: "application/vnd.github+json" };
    if (cfg.token) headers.Authorization = "Bearer " + cfg.token;

    function collect(entries) {
      var packs = [];
      (Array.isArray(entries) ? entries : []).forEach(function (f) {
        if (/\.iebpack\.json$/i.test(f.name)) packs.push({ name: f.name, path: f.path, sha: f.sha, size: f.size });
      });
      try { syncStorage().setItem(cacheKey, JSON.stringify({ at: Date.now(), packs: packs })); } catch (e) {}
      return packs;
    }

    var lastErr = null;
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        var res = await fetch(url(cfg.branch), { headers: headers });
        if (res.status === 404) {
          var body = {};
          try { body = await res.json(); } catch (e) {}
          var msg = String(body.message || "");
          if (/not found|does not exist/i.test(msg) && /version|ref|branch/i.test(msg)) {
            /* branch name is wrong -> adopt the repository's default branch */
            try {
              var meta = await ghFetch(apiBase(cfg), { headers: headers });
              var def = (await meta.json()).default_branch;
              if (def && def !== cfg.branch) {
                cfg.branch = def;
                var saved = syncConfig(); saved.branch = def; saveSyncConfig(saved);
              }
            } catch (e2) { /* keep trying with what we have */ }
            continue;
          }
          if (/This repository is empty|Not Found/i.test(msg) || msg === "") {
            /* shared folder does not exist yet -> create it (first publish) */
            if (!cfg.token) return { packs: [], offline: false, note: "shared-exercises folder is empty" };
            try {
              await ghFetch(apiBase(cfg) + "/contents/" + encodeURIComponent(cfg.folder) + "/.keep", {
                method: "PUT",
                headers: Object.assign({ "Content-Type": "application/json" }, headers),
                body: JSON.stringify({ message: "chore: create shared-exercises folder", content: "", branch: cfg.branch })
              });
              continue; /* now the folder exists — list again */
            } catch (e3) {
              return { packs: [], offline: false, note: "shared-exercises folder is empty" };
            }
          }
          throw new Error("HTTP 404 — " + msg + " (" + cfg.owner + "/" + cfg.repo + "@" + cfg.branch + ")");
        }
        if (!res.ok) throw new Error("HTTP " + res.status);
        return { packs: collect(await res.json()), offline: false };
      } catch (e) {
        lastErr = e;
        if (e && /HTTP 40[13]|Bad credentials/i.test(String(e.message))) break; /* auth issue: retrying won't help */
      }
    }
    /* all attempts failed -> serve the last known index if we have one */
    try {
      var cached = JSON.parse(syncStorage().getItem(cacheKey) || "null");
      if (cached && cached.packs) return { packs: cached.packs, offline: true, error: lastErr && lastErr.message };
    } catch (e2) {}
    /* nothing fatal — treat as "no courses published yet" unless it's clearly auth */
    if (lastErr && /HTTP 40[13]|Bad credentials/i.test(String(lastErr.message))) {
      throw new Error("GitHub rejected access (token expired/revoked?). Open Sync settings and paste a fresh token.");
    }
    return { packs: [], offline: false, note: "shared-exercises folder is empty" };
  }

  /* download one pack file over the public raw endpoint (works even without a token) */
  async function syncDownloadPack(cfg, path) {
    cfg = cfg || syncConfig();
    var res = await ghFetch(rawUrl(cfg, path));
    return await res.json();
  }

  /* upload (create or update) one pack file via the Contents API */
  async function syncUploadPack(cfg, name, packObj) {
    cfg = cfg || syncConfig();
    if (!cfg.token) throw new Error("No GitHub token configured for sync");
    var path = cfg.folder + "/" + name;
    var content = btoa(unescape(encodeURIComponent(JSON.stringify(packObj, null, 1))));
    var sha = null;
    try {
      var existing = await ghFetch(apiBase(cfg) + "/contents/" + encodeURIComponent(path) + "?ref=" + encodeURIComponent(cfg.branch), {
        headers: { Authorization: "Bearer " + cfg.token }
      });
      var ej = await existing.json();
      sha = ej.sha || null;
    } catch (e) { /* file does not exist yet -> create */ }
    var body = {
      message: (sha ? "sync(update)" : "sync(add)") + ": " + name + " · rev " + (packObj.revision || 1) + " by " + (packObj.author || "?"),
      content: content,
      branch: cfg.branch
    };
    if (sha) body.sha = sha;
    await ghFetch(apiBase(cfg) + "/contents/" + encodeURIComponent(path), {
      method: sha ? "PUT" : "PUT",
      headers: { Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return { path: path, updated: !!sha };
  }

  /* ------------------------------------------------------- local registry
     Installed-from-sync courses are remembered so that re-running Sync
     UPDATES them in place instead of creating copies. */
  function syncRegistry() {
    try { return JSON.parse(syncStorage().getItem("ieb-sync-installed") || "{}"); } catch (e) { return {}; }
  }
  function syncRegistrySet(packageId, entry) {
    var r = syncRegistry();
    r[packageId] = entry;
    syncStorage().setItem("ieb-sync-installed", JSON.stringify(r));
  }

  /* ------------------------------------------------------- installed view
     What is already on this machine, for the smart-import decision.
     Server mode: /api/installed-packs answers with packageId/revision/…
     file:// mode: fall back to the local sync registry (courses that were
     pulled from GitHub before). */
  async function listInstalledPacks() {
    try {
      if (typeof fetch === "function" && typeof location !== "undefined" &&
          (location.protocol === "http:" || location.protocol === "https:") &&
          /^(localhost|127\.|\[::1\])/.test(location.hostname)) {
        var res = await fetch("/api/installed-packs");
        if (res.ok) {
          var j = await res.json();
          if (Array.isArray(j.packs)) return j.packs;
        }
      }
    } catch (e) { /* no server — use the local registry below */ }
    var reg = syncRegistry();
    return Object.keys(reg).map(function (pid) {
      var r = reg[pid];
      return { packageId: pid, revision: r.revision || 1, fingerprint: r.fingerprint || null };
    });
  }

  /* -------------------------------------------------- content comparison
     The client and server compute fingerprints with different hash
     algorithms, so cross-comparing them always fails. For the "did anything
     actually change?" question we compare CONTENT instead: a normalized
     digest of units/lessons/tasks that both sides can build from their own
     copy of the pack. */
  function contentDigest(packObj) {
    var books = (packObj && packObj.books) || {};
    var parts = [];
    ["student", "workbook"].forEach(function (slot) {
      var book = books[slot];
      if (!book) return;
      (book.units || []).forEach(function (u) {
        (u.lessons || []).forEach(function (l) {
          (l.tasks || []).forEach(function (t) {
            parts.push(u.id + "/" + l.id + "/" + t.id + ":" + canonical(t));
          });
        });
      });
    });
    var m = (packObj && packObj.manifest) || {};
    parts.push("meta:" + (m.title || "") + "|" + (m.author || "") + "|" + (m.level || ""));
    var assetNames = Object.keys((packObj && packObj.assets) || {}).sort();
    for (var ai = 0; ai < assetNames.length; ai++) parts.push("asset:" + assetNames[ai]);
    return fnv1a(parts.join("\n"));
  }

  /* Compare an incoming remote pack against the local copy we installed or
     published before (stored in the sync registry). Returns true only when
     the actual exercise content differs — revisions alone are not enough,
     because re-publishing an unchanged course bumps the revision number. */
  function packContentChanged(packObj) {
    var reg = syncRegistry();
    var rec = packObj && packObj.packageId ? reg[packObj.packageId] : null;
    if (!rec || !rec.contentHash) return null; // nothing to compare against
    return rec.contentHash !== contentDigest(packObj);
  }

  function rememberPackContent(packObj) {
    if (!packObj || !packObj.packageId) return;
    var reg = syncRegistry();
    var rec = reg[packObj.packageId] || {};
    rec.contentHash = contentDigest(packObj);
    rec.remotePath = rec.remotePath || null;
    rec.revision = packObj.revision || rec.revision || 1;
    rec.fingerprint = packObj.fingerprint || rec.fingerprint || null;
    rec.name = (packObj.manifest && packObj.manifest.title) || rec.name || packObj.packageId;
    syncRegistrySet(packObj.packageId, rec);
  }

  /* install one downloaded pack through the local backend (server mode);
     in file:// mode there is no backend, so we remember it locally and hand
     the JSON back to the caller to offer a .iebpack download instead. */
  async function installPack(pack, decision) {
    var title = (pack.manifest && pack.manifest.title) || pack.packageId || "course";
    try {
      if (typeof fetch === "function" && typeof location !== "undefined" &&
          (location.protocol === "http:" || location.protocol === "https:") &&
          /^(localhost|127\.|\[::1\])/.test(location.hostname)) {
        var res = await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pack: pack })
        });
        if (!res.ok) {
          var msg = "HTTP " + res.status;
          try { var j = await res.json(); if (j.error) msg += " — " + j.error; } catch (e) {}
          throw new Error(msg);
        }
        var out = await res.json();
        out.title = out.title || title;
        return out;
      }
    } catch (e) {
      if (e && /HTTP|Failed/.test(String(e.message))) throw e; // real backend error
      /* no backend at all -> offline install: remember + return for download */
    }
    syncRegistrySet(pack.packageId, {
      remotePath: null, revision: pack.revision || 1,
      fingerprint: pack.fingerprint, name: title, offline: true
    });
    return { action: (decision && decision.action) || "install", title: title, offline: true, pack: pack };
  }

  /* the heart of the one-button flow: pull everything, apply smart-import
     decisions per package, remember what came from sync */
  async function syncPull(onProgress) {
    var cfg = syncConfig();
    var result = { added: [], updated: [], skipped: [], merged: [], errors: [], offline: false, note: "" };
    var listed;
    try {
      listed = await syncListPacks(cfg);
    } catch (e) {
      result.errors.push("Cannot reach GitHub: " + e.message);
      return result;
    }
    result.offline = !!listed.offline;
    if (listed.note) result.note = listed.note;
    var installed = await listInstalledPacks();
    for (var i = 0; i < listed.packs.length; i++) {
      var p = listed.packs[i];
      if (onProgress) onProgress(i + 1, listed.packs.length, p.name);
      try {
        var pack = await syncDownloadPack(cfg, p.path);
        /* FIRST: compare against the exact copy we installed/published last
           time. If the exercise content is byte-for-byte equivalent there is
           nothing to do — this stops your own course from re-downloading on
           every Update press (and survives client/server hash mismatch). */
        if (packContentChanged(pack) === false) {
          result.skipped.push(p.name);
          continue;
        }
        var decision = decidePackAction(pack, installed);
        if (decision.action === "duplicate") { result.skipped.push(p.name); continue; }
        var install = await installPack(pack, decision);
        rememberPackContent(pack);
        syncRegistrySet(pack.packageId, { remotePath: p.path, revision: pack.revision || 1, fingerprint: pack.fingerprint, name: p.name });
        installed = await listInstalledPacks();   // keep the view fresh for later files
        var act = install.action || decision.action;
        if (act === "merge" || act === "fork") result.merged.push(install.title || p.name);
        else if (act === "update") result.updated.push(install.title || p.name);
        else if (act !== "skip") result.added.push(install.title || p.name);
      } catch (e) {
        result.errors.push(p.name + ": " + e.message);
      }
    }
    return result;
  }

  /* publish one local course pack into the shared GitHub folder */
  async function syncPushPack(pack) {
    var cfg = syncConfig();
    if (!cfg.token) throw new Error("No GitHub token configured for sync");
    /* If the exact same content is already in the hub, don't push a new
       revision — re-publishing an unchanged course used to make every peer
       (and yourself) "update" on the next sync for no reason. */
    var name = pack.packageId + ".iebpack.json";
    try {
      var listed = await syncListPacks(cfg);
      var mine = null;
      (listed.packs || []).forEach(function (p) { if (p.name === name) mine = p; });
      if (mine) {
        var remote = await syncDownloadPack(cfg, mine.path);
        if (canonical(remote.books || {}) === canonical(pack.books || {}) &&
            canonical((remote.manifest || {}).title) === canonical((pack.manifest || {}).title)) {
          rememberPackContent(pack);
          syncRegistrySet(pack.packageId, { remotePath: cfg.folder + "/" + name,
            revision: remote.revision || pack.revision || 1,
            fingerprint: pack.fingerprint, name: name });
          return { name: name, unchanged: true };
        }
      }
    } catch (e) { /* listing failed -> just push normally */ }
    await syncUploadPack(cfg, name, pack);
    rememberPackContent(pack);
    syncRegistrySet(pack.packageId, {
      remotePath: cfg.folder + "/" + name,
      revision: pack.revision || 1, fingerprint: pack.fingerprint, name: name
    });
    return { name: name };
  }

  /* expose the sync API on the global object (browsers) and via exports */
  function module_exports_sync() { return {
    DEFAULTS: SYNC_DEFAULTS, config: syncConfig, saveConfig: saveSyncConfig,
    listPacks: syncListPacks, downloadPack: syncDownloadPack, uploadPack: syncUploadPack,
    pull: syncPull, pushPack: syncPushPack,
    registry: syncRegistry, registrySet: syncRegistrySet,
    contentDigest: contentDigest, packContentChanged: packContentChanged,
    rememberPackContent: rememberPackContent,
    listInstalled: listInstalledPacks, installPack: installPack };
  }
  if (typeof window !== "undefined") window.IEB_SYNC = module_exports_sync();

  return {
    FORMAT_VERSION: FORMAT_VERSION,
    TASK_TYPES: TASK_TYPES, TYPE_IDS: TYPE_IDS, MEDIA_ICONS: MEDIA_ICONS,
    defaultTask: defaultTask, blankTask: blankTask, generateWordGrid: generateWordGrid,
    slugify: slugify, makeId: makeId,
    validateTask: validateTask, validateBook: validateBook, validateManifest: validateManifest,
    buildPack: buildPack, readPack: readPack,
    packFingerprint: packFingerprint, decidePackAction: decidePackAction, mergeBooks: mergeBooks,
    starterDraft: starterDraft,
    SYNC_DEFAULTS: SYNC_DEFAULTS, syncConfig: syncConfig, saveSyncConfig: saveSyncConfig,
    syncRawUrl: rawUrl, syncApiBase: apiBase, ghFetch: ghFetch,
    syncListPacks: syncListPacks, syncDownloadPack: syncDownloadPack, syncUploadPack: syncUploadPack,
    syncRegistry: syncRegistry, syncRegistrySet: syncRegistrySet, syncPull: syncPull,
    syncPushPack: syncPushPack, sync: module_exports_sync()
  };
});
