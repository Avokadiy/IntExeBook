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
    { type: "matching", icon: "🔗", label: "Matching", hint: "Match items from two columns." }
  ];
  var TYPE_IDS = TASK_TYPES.map(function (t) { return t.type; });

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
  function buildPack(obj) {
    return {
      format: "ieb-pack",
      version: FORMAT_VERSION,
      exported: new Date().toISOString(),
      generator: "IntExeBook",
      manifest: obj.manifest,
      books: obj.books || {},
      assets: obj.assets || {}
    };
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
    return { ok: errors.length === 0, errors: errors, manifest: mf.value, books: books, assets: assets };
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

  return {
    FORMAT_VERSION: FORMAT_VERSION,
    TASK_TYPES: TASK_TYPES, TYPE_IDS: TYPE_IDS, MEDIA_ICONS: MEDIA_ICONS,
    slugify: slugify, makeId: makeId,
    validateTask: validateTask, validateBook: validateBook, validateManifest: validateManifest,
    buildPack: buildPack, readPack: readPack,
    starterDraft: starterDraft
  };
});
