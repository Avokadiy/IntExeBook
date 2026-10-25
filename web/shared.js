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
    { type: "translate-match", icon: "🌍", label: "Translate & match", hint: "Two-column matching with a translation twist." },
    /* --- extended set (v2): audio / video / text skills, 20 new types --- */
    { type: "listen-choice", icon: "🎧", label: "Listen & choose", hint: "Audio clip plus a multiple-choice question." },
    { type: "dictation", icon: "👂", label: "Dictation", hint: "Listen to the audio and type exactly what you hear." },
    { type: "listen-gap", icon: "🎼", label: "Listen & fill gaps", hint: "Song or dialogue lyrics with blanks to complete while listening." },
    { type: "video-quiz", icon: "🎬", label: "Video quiz", hint: "Watch a video clip and answer questions about it." },
    { type: "video-sequence", icon: "📽️", label: "Order the video events", hint: "Put scenes / moments of a video in the right order." },
    { type: "reading-truefalse", icon: "📖", label: "Reading true / false", hint: "Read a passage, then judge statements as true or false." },
    { type: "short-answer", icon: "💬", label: "Short answer", hint: "Type a free answer — the student checks it against a model." },
    { type: "spelling", icon: "🔡", label: "Spelling", hint: "Hear or see a prompt and type the word correctly." },
    { type: "multiple-select", icon: "☑️", label: "Multiple select", hint: "Choose ALL correct options among several." },
    { type: "reorder-text", icon: "🪜", label: "Reorder the text", hint: "Restore a dialogue or paragraph — put the lines back in order." },
    { type: "categorize", icon: "🗂️", label: "Categorize", hint: "Drag every item into its correct category box." },
    { type: "crosswords", icon: "➕", label: "Crosswords", hint: "Mini crossword — clues across and down share letters." },
    { type: "sentence-transform", icon: "🔁", label: "Transform the sentence", hint: "Rewrite the sentence as instructed (keep the meaning)." },
    { type: "error-correction", icon: "🩹", label: "Find the mistake", hint: "One word in the sentence is wrong — click it and fix it." },
    { type: "initials", icon: "🔤", label: "First letters", hint: "Type words that start with the given letters (1st-letter prompts)." },
    { type: "choose-picture", icon: "🌄", label: "Choose the picture", hint: "Read / listen to a prompt and click the matching picture." },
    { type: "timeline", icon: "🕰️", label: "Timeline", hint: "Arrange events on a timeline from earliest to latest." },
    { type: "definition-match", icon: "📚", label: "Definition match", hint: "Match each word with its definition." },
    { type: "memory-pairs", icon: "🧠", label: "Memory pairs", hint: "Flip cards face-down and find all matching pairs." },
    { type: "speaking-repeat", icon: "🎙️", label: "Speak & record", hint: "Listen to a model, record your voice and compare." }
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
      /* --- extended set (v2) starters --- */
      case "listen-choice": return { options: ["", ""], answerIndex: 0 };
      case "dictation": return { text: "" };
      case "listen-gap": return { text: "He ___ me yesterday.", blanks: [{ answers: ["called"] }] };
      case "video-quiz": return { questions: [{ text: "", options: ["", ""], answerIndex: 0 }] };
      case "video-sequence": return { items: ["", "", ""] };
      case "reading-truefalse": return { passage: "", statements: [{ text: "", answer: true }, { text: "", answer: false }] };
      case "short-answer": return { question: "", answers: [""], model: "" };
      case "spelling": return { word: "", prompt: "" };
      case "multiple-select": return { options: [{ text: "", correct: true }, { text: "", correct: false }, { text: "", correct: false }] };
      case "reorder-text": return { lines: ["", "", ""] };
      case "categorize": return { categories: [{ name: "", items: [""] }, { name: "", items: [""] }] };
      case "crosswords": return { cells: [], clues: [] };
      case "sentence-transform": return { source: "", task: "", answers: [""] };
      case "error-correction": return { sentence: "", wrongIndex: 0, fix: "" };
      case "initials": return { items: [{ word: "", initial: "" }] };
      case "choose-picture": return { prompt: "", images: [{ src: "", caption: "", correct: true }, { src: "", caption: "", correct: false }] };
      case "timeline": return { events: [{ label: "", date: "" }, { label: "", date: "" }] };
      case "definition-match": return { pairs: [{ left: "", right: "" }, { left: "", right: "" }] };
      case "memory-pairs": return { pairs: [{ front: "", back: "" }, { front: "", back: "" }] };
      case "speaking-repeat": return { modelText: "" };
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
    } else if (type === "listen-choice") {
      var lcOpts = Array.isArray(raw.options) ? raw.options.map(str) : [];
      if (lcOpts.filter(Boolean).length < 2) err("needs at least 2 answer options");
      var lcAi = parseInt(raw.answerIndex, 10);
      if (!(lcAi >= 0 && lcAi < lcOpts.length)) err("no correct option marked");
      if (!(Array.isArray(raw.media) && raw.media.length)) warnings.push("attach an audio clip in the Media tab — this is a listening task");
      out.options = lcOpts;
      out.answerIndex = isNaN(lcAi) ? -1 : lcAi;
    } else if (type === "dictation") {
      var dicText = str(raw.text);
      if (!dicText) err("the dictation text (what the student should type) is empty");
      out.text = dicText;
      if (!(Array.isArray(raw.media) && raw.media.length)) warnings.push("attach an audio clip in the Media tab — this is a listening task");
    } else if (type === "listen-gap") {
      var lgText = str(raw.text);
      var lgGaps = (lgText.match(/_{2,}/g) || []).length;
      var lgBlanks = Array.isArray(raw.blanks) ? raw.blanks : [];
      if (!lgText) err("the lyrics / sentence text is empty");
      if (!lgGaps) err("no gaps found — use ___ in the text");
      if (lgGaps && lgBlanks.length !== lgGaps) err(lgGaps + " gap(s) in the text but " + lgBlanks.length + " answer(s) given");
      var lgClean = [];
      lgBlanks.forEach(function (b, i) {
        var ans = isObj(b) ? (Array.isArray(b.answers) ? b.answers : []) : [];
        var list = ans.map(str).filter(Boolean);
        if (!list.length) err("gap " + (i + 1) + " has no accepted answer");
        var hint = isObj(b) ? str(b.hint) : "";
        lgClean.push(hint ? { answers: list, hint: hint } : { answers: list });
      });
      out.text = lgText;
      out.blanks = lgClean;
      if (!(Array.isArray(raw.media) && raw.media.length)) warnings.push("attach an audio clip in the Media tab — this is a listening task");
    } else if (type === "video-quiz") {
      var vqList = Array.isArray(raw.questions) ? raw.questions : [];
      if (!vqList.length) err("add at least one question about the video");
      var vqClean = [];
      vqList.forEach(function (q, i) {
        var qt = isObj(q) ? str(q.text) : "";
        var qo = isObj(q) && Array.isArray(q.options) ? q.options.map(str) : [];
        var qa = isObj(q) ? parseInt(q.answerIndex, 10) : -1;
        if (!qt) err("question " + (i + 1) + " has no text");
        if (qo.filter(Boolean).length < 2) err("question " + (i + 1) + " needs at least 2 options");
        if (!(qa >= 0 && qa < qo.length)) err("question " + (i + 1) + " has no correct option marked");
        vqClean.push({ text: qt, options: qo, answerIndex: isNaN(qa) ? -1 : qa });
      });
      out.questions = vqClean;
      if (!(Array.isArray(raw.media) && raw.media.some(function (m) { return m.type === "video"; })))
        warnings.push("attach a video clip in the Media tab");
    } else if (type === "video-sequence") {
      var vsItems = Array.isArray(raw.items) ? raw.items.map(str).filter(Boolean) : [];
      if (vsItems.length < 3) err("needs at least 3 events to order");
      out.items = vsItems;
    } else if (type === "reading-truefalse") {
      var rtPassage = str(raw.passage);
      if (!rtPassage) err("the reading passage is empty");
      var rtSt = Array.isArray(raw.statements) ? raw.statements : [];
      if (rtSt.length < 2) err("add at least 2 statements");
      var rtClean = [];
      rtSt.forEach(function (s, i) {
        var st = isObj(s) ? str(s.text) : "";
        if (!st) { err("statement " + (i + 1) + " is empty"); return; }
        if (typeof (isObj(s) ? s.answer : undefined) !== "boolean") err("statement " + (i + 1) + " must be marked true or false");
        rtClean.push({ text: st, answer: !!(isObj(s) && s.answer) });
      });
      out.passage = rtPassage;
      out.statements = rtClean;
    } else if (type === "short-answer") {
      var saQ = str(raw.question);
      var saAns = Array.isArray(raw.answers) ? raw.answers.map(str).filter(Boolean) : [];
      if (!saQ) err("the question is empty");
      if (!saAns.length) err("add at least one accepted answer");
      out.question = saQ;
      out.answers = saAns;
      if (str(raw.model)) out.model = str(raw.model);
    } else if (type === "spelling") {
      var spWord = str(raw.word);
      if (!spWord) err("the target word is empty");
      if (/[.,!?]/.test(spWord)) err("the word itself should not contain punctuation");
      out.word = spWord;
      if (str(raw.prompt)) out.prompt = str(raw.prompt);
    } else if (type === "multiple-select") {
      var msRaw = Array.isArray(raw.options) ? raw.options : [];
      var msClean = [];
      msRaw.forEach(function (o, i) {
        var t = isObj(o) ? str(o.text) : str(o);
        if (!t) { err("option " + (i + 1) + " is empty"); return; }
        msClean.push({ text: t, correct: isObj(o) ? !!o.correct : false });
      });
      if (msClean.length < 3) err("needs at least 3 options");
      var msOk = msClean.filter(function (o) { return o.correct; }).length;
      if (!msOk) err("mark at least one option as correct");
      if (msOk >= msClean.length) err("keep at least one wrong option");
      out.options = msClean;
    } else if (type === "reorder-text") {
      var roLines = Array.isArray(raw.lines) ? raw.lines.map(str).filter(Boolean) : [];
      if (roLines.length < 3) err("needs at least 3 lines in the correct order");
      out.lines = roLines;
    } else if (type === "categorize") {
      var cgCats = Array.isArray(raw.categories) ? raw.categories : [];
      if (cgCats.length < 2) err("needs at least 2 categories");
      var cgClean = [], cgNames = {};
      cgCats.forEach(function (c, i) {
        var name = isObj(c) ? str(c.name) : "";
        var items = isObj(c) && Array.isArray(c.items) ? c.items.map(str).filter(Boolean) : [];
        if (!name) err("category " + (i + 1) + " has no name");
        else if (cgNames[norm(name)]) err("duplicate category “" + name + "”");
        else if (!items.length) err("category “" + name + "” has no items");
        else { cgNames[norm(name)] = 1; cgClean.push({ name: name, items: items }); }
      });
      var cgTotal = cgClean.reduce(function (n, c) { return n + c.items.length; }, 0);
      if (cgTotal < 3) err("add at least 3 items in total");
      out.categories = cgClean;
    } else if (type === "crosswords") {
      var cwCells = Array.isArray(raw.cells) ? raw.cells : [];
      var cwClues = Array.isArray(raw.clues) ? raw.clues : [];
      if (!cwCells.length) err("draw the grid first — click cells in the editor preview (or use the generator)");
      if (cwClues.length < 2) err("add at least 2 clues");
      var cwClean = [];
      cwClues.forEach(function (cl, i) {
        var w = isObj(cl) ? String(cl.word || "").toUpperCase().replace(/[^A-ZА-ЯЁ]/g, "") : "";
        var d = isObj(cl) ? str(cl.dir) : "";
        var q = isObj(cl) ? str(cl.clue) : "";
        if (!w || ["across", "down"].indexOf(d) < 0 || !q) err("clue " + (i + 1) + ": word, direction (across/down) and clue text are required");
        else cwClean.push({ word: w, dir: d, clue: q });
      });
      var cwGrid = {};
      cwCells.forEach(function (c) { if (isObj(c)) cwGrid[c.x + "," + c.y] = 1; });
      cwClean.forEach(function (cl) {
        var placed = false;
        Object.keys(cwGrid).forEach(function (key) {
          if (placed) return;
          var xy = key.split(","), sx = parseInt(xy[0], 10), sy = parseInt(xy[1], 10);
          var dx = cl.dir === "across" ? 1 : 0, dy = cl.dir === "down" ? 1 : 0;
          for (var k = 0; k < cl.word.length; k++) {
            if (!cwGrid[(sx + dx * k) + "," + (sy + dy * k)]) return;
          }
          placed = true;
        });
        if (!placed) err("word “" + cl.word + "” does not fit into the drawn grid");
      });
      out.cells = cwCells.map(function (c) { return { x: parseInt(c.x, 10) || 0, y: parseInt(c.y, 10) || 0 }; });
      out.clues = cwClean;
    } else if (type === "sentence-transform") {
      var stSrc = str(raw.source);
      var stAns = Array.isArray(raw.answers) ? raw.answers.map(str).filter(Boolean) : [];
      if (!stSrc) err("the source sentence is empty");
      if (!stAns.length) err("add at least one accepted transformed sentence");
      out.source = stSrc;
      if (str(raw.task)) out.task = str(raw.task);
      out.answers = stAns;
    } else if (type === "error-correction") {
      var ecSent = str(raw.sentence);
      var ecTok = ecSent.split(/\s+/).filter(Boolean);
      var ecIdx = parseInt(raw.wrongIndex, 10);
      if (!ecSent) err("the sentence is empty");
      if (ecTok.length < 3) err("the sentence needs at least 3 words");
      if (!(ecIdx >= 0 && ecIdx < ecTok.length)) err("mark which word is wrong (click it in the editor preview)");
      out.sentence = ecSent;
      out.wrongIndex = isNaN(ecIdx) ? -1 : ecIdx;
      if (str(raw.fix)) out.fix = str(raw.fix);
    } else if (type === "initials") {
      var iniItems = Array.isArray(raw.items) ? raw.items : [];
      var iniClean = [];
      iniItems.forEach(function (it, i) {
        var w = isObj(it) ? str(it.word) : "";
        if (!w) { err("item " + (i + 1) + " has no word"); return; }
        iniClean.push({ word: w, initial: (isObj(it) && str(it.initial)) ? str(it.initial)[0].toLowerCase() : w[0].toLowerCase() });
      });
      if (iniClean.length < 2) err("add at least 2 words");
      out.items = iniClean;
    } else if (type === "choose-picture") {
      var cpPics = Array.isArray(raw.images) ? raw.images : [];
      if (cpPics.length < 2) err("add at least 2 pictures");
      var cpClean2 = [], cpOk = 0;
      cpPics.forEach(function (p, i) {
        var src = isObj(p) ? str(p.src) : "";
        if (!src) { err("picture " + (i + 1) + " is missing — upload images in the Content form"); return; }
        var ok = isObj(p) ? !!p.correct : false;
        if (ok) cpOk++;
        cpClean2.push({ src: src, caption: isObj(p) ? str(p.caption) : "", correct: ok });
      });
      if (!cpOk) err("mark one picture as the correct answer");
      if (cpOk >= cpClean2.length) err("keep at least one wrong picture");
      if (!str(raw.prompt)) err("the prompt (question / word the student matches) is empty");
      out.prompt = str(raw.prompt);
      out.images = cpClean2;
    } else if (type === "timeline") {
      var tlEv = Array.isArray(raw.events) ? raw.events : [];
      if (tlEv.length < 3) err("needs at least 3 events");
      var tlClean = [];
      tlEv.forEach(function (e, i) {
        var lab = isObj(e) ? str(e.label) : "", dt = isObj(e) ? str(e.date) : "";
        if (!lab) err("event " + (i + 1) + " has no label");
        else tlClean.push({ label: lab, date: dt || undefined });
      });
      out.events = tlClean;
    } else if (type === "definition-match") {
      var dmPairs = Array.isArray(raw.pairs) ? raw.pairs : [];
      if (dmPairs.length < 2) err("needs at least 2 word/definition pairs");
      var dmSeen = {}, dmClean = [];
      dmPairs.forEach(function (p, i) {
        var l = isObj(p) ? str(p.left) : "", r = isObj(p) ? str(p.right) : "";
        if (!l || !r) err("pair " + (i + 1) + " is incomplete (word + definition needed)");
        else if (dmSeen[norm(l)]) err("duplicate word “" + l + "”");
        else { dmSeen[norm(l)] = 1; dmClean.push({ left: l, right: r }); }
      });
      out.pairs = dmClean;
    } else if (type === "memory-pairs") {
      var mpPairs = Array.isArray(raw.pairs) ? raw.pairs : [];
      if (mpPairs.length < 3) err("needs at least 3 card pairs");
      var mpClean = [];
      mpPairs.forEach(function (p, i) {
        var f = isObj(p) ? str(p.front) : "", b = isObj(p) ? str(p.back) : "";
        if (!f || !b) err("pair " + (i + 1) + " is incomplete (front + back needed)");
        else mpClean.push({ front: f, back: b });
      });
      out.pairs = mpClean;
    } else if (type === "speaking-repeat") {
      var srText = str(raw.modelText);
      if (!srText) err("the model phrase the student repeats is empty");
      out.modelText = srText;
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

  /* mini crossword layout builder used by the authoring editor:
     words run across; every second word also runs down from its first
     letter. Returns { ok, cells:[{x,y}], clues:[{word,dir,clue}] }. */
  function generateCrosswords(words) {
    var list = (words || []).map(function (w) {
      return String(w || "").toUpperCase().replace(/[^A-ZА-ЯЁ]/g, "");
    }).filter(Boolean).slice(0, 6);
    if (list.length < 2) return { ok: false, cells: [], clues: [] };
    var cells = {}, clues = [];
    function addCell(x, y) { cells[x + "," + y] = 1; }
    var y = 0;
    list.forEach(function (w, i) {
      for (var k = 0; k < w.length; k++) addCell(k, y);
      clues.push({ word: w, dir: "across", clue: "" });
      if (i % 2 === 1) {
        for (var d = 0; d < w.length; d++) addCell(0, y + d);
        clues.push({ word: w, dir: "down", clue: "" });
      }
      y += w.length > 3 ? 2 : 3;
    });
    var out = Object.keys(cells).map(function (key) {
      var xy = key.split(",");
      return { x: parseInt(xy[0], 10), y: parseInt(xy[1], 10) };
    });
    return { ok: true, cells: out, clues: clues };
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

  /* The shared hub is a dedicated BRANCH of this repository — never a random
     feature branch. Everything sync-related (list / pull / publish) uses the
     same constant, so a course published from any working branch lands in the
     hub and every teacher pulls from exactly that place. To move the hub to
     another branch, change SHARED_HUB_BRANCH below and push once; old packs
     can be copied over with `git cherry-pick`/`git mv`. */
  var SHARED_HUB_BRANCH = "shared-hub";
  var SYNC_DEFAULTS = { owner: "Avokadiy", repo: "IntExeBook", branch: SHARED_HUB_BRANCH, folder: "shared-exercises" };

  var SYNC_BRANCH_RESOLVED = false;
  /* One-time per session sanity check: if the configured hub branch no longer
     exists in the remote repository (renamed/deleted), adopt the repository's
     default branch instead of silently listing an empty folder. */
  async function syncResolveHubBranch(cfg) {
    if (SYNC_BRANCH_RESOLVED || !cfg || !cfg.token) return cfg;
    try {
      var headers = { Accept: "application/vnd.github+json", Authorization: "Bearer " + cfg.token };
      var probe = await fetch(apiBase(cfg) + "/contents/" + encodeURIComponent(cfg.folder) + "?ref=" + encodeURIComponent(cfg.branch), { headers: headers });
      SYNC_BRANCH_RESOLVED = true;
      if (probe.status === 404) {
        var meta = await ghFetch(apiBase(cfg), { headers: headers });
        var def = (await meta.json()).default_branch;
        if (def && def !== cfg.branch) {
          cfg.branch = def;
          var saved = syncConfig(); saved.branch = def; saveSyncConfig(saved);
        }
      }
    } catch (e) { /* network issue — keep the configured branch */ }
    return cfg;
  }

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
    /* all attempts failed -> serve the last known index if we have one.
       NOTE: only a NON-EMPTY cache may masquerade as an offline listing —
       falling back to an empty cached list here used to hide real failures
       behind “shared-exercises folder is empty”. */
    try {
      var cached = JSON.parse(syncStorage().getItem(cacheKey) || "null");
      if (cached && Array.isArray(cached.packs) && cached.packs.length) {
        return { packs: cached.packs, offline: true, error: lastErr && lastErr.message };
      }
    } catch (e2) {}
    /* nothing fatal — treat as "no courses published yet" unless it's clearly auth */
    if (lastErr && /HTTP 40[13]|Bad credentials/i.test(String(lastErr.message))) {
      throw new Error("GitHub rejected access (token expired/revoked?). Open Sync settings and paste a fresh token.");
    }
    /* A genuine network failure must NOT be silently reported as an empty
       hub — surface it so syncPull shows an error instead of a fake success. */
    if (lastErr) throw lastErr;
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
  /* IMPORTANT: the digest must be stable across app restarts and across
     machines, so it deliberately EXCLUDES volatile fields (timestamps like
     createdAt/publishedAt, revision numbers, author-change metadata). Only
     real exercise content + core meta feed into it. */
  var DIGEST_SKIP_KEYS = {
    createdAt: 1, updatedAt: 1, publishedAt: 1, importedAt: 1, syncedAt: 1,
    revision: 1, fingerprint: 1, packageId: 1, _passport: 1, contributors: 1,
    lastEditor: 1, editedAt: 1, mergedFrom: 1, mergeHistory: 1, history: 1,
    localModified: 1, authorKey: 1
  };
  function canonicalStable(value, depth) {
    depth = depth || 0;
    if (depth > 24) return "?";
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(function (v) { return canonicalStable(v, depth + 1); }).join(",") + "]";
    var keys = Object.keys(value).filter(function (k) { return !DIGEST_SKIP_KEYS[k]; }).sort();
    return "{" + keys.map(function (k) { return JSON.stringify(k) + ":" + canonicalStable(value[k], depth + 1); }).join(",") + "}";
  }
  function contentDigest(packObj) {
    var books = (packObj && packObj.books) || {};
    var parts = [];
    ["student", "workbook"].forEach(function (slot) {
      var book = books[slot];
      if (!book) return;
      (book.units || []).forEach(function (u) {
        (u.lessons || []).forEach(function (l) {
          (l.tasks || []).forEach(function (t) {
            parts.push(u.id + "/" + l.id + "/" + t.id + ":" + canonicalStable(t));
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

  function rememberPackContent(packObj, extra) {
    if (!packObj || !packObj.packageId) return;
    var reg = syncRegistry();
    var rec = reg[packObj.packageId] || {};
    rec.contentHash = contentDigest(packObj);
    rec.remotePath = rec.remotePath || null;
    rec.revision = packObj.revision || rec.revision || 1;
    rec.fingerprint = packObj.fingerprint || rec.fingerprint || null;
    rec.name = (packObj.manifest && packObj.manifest.title) || rec.name || packObj.packageId;
    if (extra) for (var k in extra) if (extra[k] != null) rec[k] = extra[k];
    syncRegistrySet(packObj.packageId, rec);
  }

  /* After a successful server-side install/update/merge we re-read the
     installed passport from /api/installed-packs. If the backend did NOT
     stamp the packageId into the course (older server build), we flag the
     registry record "serverBlind": without this flag the next Update press
     would not recognise the already-installed course and would install a
     duplicate copy of it. With the flag we still skip by content digest —
     zero duplicates even against an old backend. */
  async function confirmServerPassport(packObj) {
    try {
      var packs = await listInstalledPacks();
      for (var i = 0; i < packs.length; i++) {
        if (packs[i] && packs[i].packageId === packObj.packageId) return true;
      }
    } catch (e) { /* unreachable */ }
    return false;
  }

  /* install one downloaded pack through the local backend (server mode).
     In file:// mode there is no backend and a browser page cannot write into
     shared-exercises/ — so NOTHING is installed locally; we only remember the
     pack in the registry and hand the JSON back so the UI can offer a
     .iebpack download. The caller must treat `offline: true` as “not really
     updated” (see syncPull) to avoid false success reports. */
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

  /* Pull every shared course from GitHub.

     Correctness rules (bug fix — “reports all courses as updated even though
     shared-exercises/ is empty”):
       * a course may be counted in added/updated/merged ONLY after it was
         actually downloaded AND successfully installed this run;
       * nothing was listed  -> report that plainly instead of pretending the
         previously-known courses were refreshed;
       * an install failure must land in errors, never silently inflate the
         success counters. */
  /* forget a course everywhere it is remembered on this machine: the local
     sync registry, and — in server mode when the founder key is available —
     the installed folder under textbooks/ (see /api/admin/hub-remove-local).
     Used when a hub course was deleted upstream. */
  async function uninstallPackLocal(packageId) {
    var r = syncRegistry();
    if (r[packageId]) { delete r[packageId]; syncStorage().setItem("ieb-sync-installed", JSON.stringify(r)); }
    var akey = null;
    try { akey = syncStorage().getItem("ieb-admin-key") || ""; } catch (e) {}
    try {
      if (akey && typeof fetch === "function" && typeof location !== "undefined" &&
          (location.protocol === "http:" || location.protocol === "https:") &&
          /^(localhost|127\.|\[::1\])/.test(location.hostname)) {
        await fetch("/api/admin/hub-remove-local?key=" + encodeURIComponent(akey), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ packageIds: [packageId] })
        });
      }
    } catch (e2) { /* no backend — browser-only state already cleaned */ }
  }

  async function syncPull(onProgress) {
    var cfg = await syncResolveHubBranch(syncConfig());
    var result = { added: [], updated: [], skipped: [], merged: [], removed: [], errors: [], offline: false, note: "", listed: 0 };
    var listed;
    try {
      listed = await syncListPacks(cfg);
    } catch (e) {
      result.errors.push("Cannot reach GitHub: " + e.message);
      return result;
    }
    /* DELETIONS PROPAGATE: courses we previously installed from the hub that
       are no longer in the remote folder were deleted by their author (or by
       the admin panel) — remove them locally too so teachers' lists mirror
       the hub exactly. Only for a fresh (non-offline, non-empty) listing. */
    var listedPacks = (listed && listed.packs) || [];
    if (!listed.offline && listedPacks.length) {
      try {
        var remoteIds = {};
        listedPacks.forEach(function (p) {
          remoteIds[/\.iebpack\.json$/i.test(p.name) ? p.name.replace(/\.iebpack\.json$/i, "") : p.name] = true;
        });
        var reg = syncRegistry();
        Object.keys(reg).forEach(function (pid) {
          var ent = reg[pid] || {};
          if (ent.remotePath && !remoteIds[pid] && !ent.localModified) {
            result.removed.push(pid);
            delete reg[pid];   /* browser-side bookkeeping happens instantly */
          }
        });
        syncStorage().setItem("ieb-sync-installed", JSON.stringify(reg));
      } catch (eDel) { /* bookkeeping only — never fail the pull over it */ }
    }
    result.offline = !!listed.offline;
    if (listed.note) result.note = listed.note;
    var packs = (listed && listed.packs) || [];
    result.listed = packs.length;
    if (!packs.length) {
      /* Nothing in the shared folder (or only a stale cache): say so instead
         of reporting fake updates. A cached-but-empty index is treated the
         same way — an empty listing can never mean “N courses updated”. */
      if (!result.note) result.note = "shared-exercises folder is empty — no published courses to update";
      return result;
    }
    var installed = await listInstalledPacks();
    for (var i = 0; i < packs.length; i++) {
      var p = packs[i];
      if (onProgress) onProgress(i + 1, packs.length, p.name);
      try {
        /* ZERO-COPY GUARANTEE: if this exact file was already pulled into a
           course on THIS machine before (even in an earlier browser session),
           never touch it again. The old code re-downloaded and re-installed
           packs whose registry entry lacked a content hash — that is what
           created duplicate courses after every app restart. */
        var reg = syncRegistry();
        var pidGuess = /\.iebpack\.json$/i.test(p.name) ? p.name.replace(/\.iebpack\.json$/i, "") : null;
        var knownReg = reg[pidGuess] || null;
        var seenPath = knownReg && knownReg.remotePath === p.path;
        if (seenPath && !knownReg.localModified) {
          result.skipped.push(p.name);
          continue;
        }
        var pack = await syncDownloadPack(cfg, p.path);
        if (!knownReg && pack.packageId) {
          knownReg = reg[pack.packageId] || null;
          seenPath = knownReg && knownReg.remotePath === p.path;
          if (seenPath && !knownReg.localModified) { result.skipped.push(p.name); continue; }
        }
        /* FIRST: compare against the exact copy we installed/published last
           time. If the exercise content is byte-for-byte equivalent there is
           nothing to do — this stops your own course from re-downloading on
           every Update press (and survives client/server hash mismatch). */
        if (packContentChanged(pack) === false) {
          if (knownReg) syncRegistrySet(pack.packageId, Object.assign({}, knownReg, { remotePath: p.path, revision: pack.revision || 1 }));
          else rememberPackContent(pack), syncRegistrySet(pack.packageId, { remotePath: p.path, revision: pack.revision || 1, fingerprint: pack.fingerprint, name: p.name });
          result.skipped.push(p.name);
          continue;
        }
        var decision = decidePackAction(pack, installed);
        if (decision.action === "duplicate") {
          rememberPackContent(pack);
          syncRegistrySet(pack.packageId, Object.assign({}, syncRegistry()[pack.packageId] || {}, { remotePath: p.path, revision: pack.revision || 1, fingerprint: pack.fingerprint, name: p.name }));
          result.skipped.push(p.name); continue;
        }
        var install = await installPack(pack, decision);
        if (!install || install.ok === false) {
          throw new Error((install && install.error) || "installation failed");
        }
        /* verify the backend really stamped our packageId into the course;
           if not (old server build), remember that fact so the NEXT sync
           still skips this pack by content digest instead of installing a
           duplicate copy. */
        var stamped = await confirmServerPassport(pack);
        rememberPackContent(pack, { remotePath: p.path, revision: pack.revision || 1,
          fingerprint: pack.fingerprint, name: p.name, serverBlind: !stamped });
        installed = await listInstalledPacks();   // keep the view fresh for later files
        var act = install.action || decision.action;
        if (act === "merge" || act === "fork") result.merged.push(install.title || p.name);
        else if (act === "update") result.updated.push(install.title || p.name);
        else if (act === "skip") result.skipped.push(p.name);
        else result.added.push(install.title || p.name);
      } catch (e) {
        result.errors.push(p.name + ": " + e.message);
      }
    }
    return result;
  }

  /* publish one local course pack into the shared GitHub folder */
  async function syncPushPack(pack) {
    var cfg = await syncResolveHubBranch(syncConfig());
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

  /* delete one pack file from the shared hub branch (admin panel).
     Uses the Contents API DELETE with the file's current blob sha; a stale
     sha (file changed since listing) is refreshed once and retried. */
  async function syncDeletePack(cfg, name) {
    cfg = cfg || await syncResolveHubBranch(syncConfig());
    if (!cfg.token) throw new Error("No GitHub token configured for sync");
    /* GitHub treats "/" as a path separator, so the folder part must stay
       literal — only the file name gets percent-encoded. */
    var path = cfg.folder + "/" + name;
    var apiPath = cfg.folder + "/" + encodeURIComponent(name);
    var headers = { Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github+json" };
    async function fetchSha() {
      var r = await ghFetch(apiBase(cfg) + "/contents/" + apiPath
                            + "?ref=" + encodeURIComponent(cfg.branch), { headers: headers });
      var j = await r.json();
      return j && j.sha;
    }
    var sha = null;
    try { sha = await fetchSha(); } catch (e) { return { deleted: false, missing: true }; }
    var body = { message: "admin(hub): remove " + name, branch: cfg.branch, sha: sha };
    try {
      await ghFetch(apiBase(cfg) + "/contents/" + apiPath, {
        method: "DELETE", headers: headers, body: JSON.stringify(body)
      });
    } catch (e) {
      /* conflict (409) — someone changed the file after we listed it:
         grab the fresh sha and retry exactly once */
      if (!/HTTP 409/.test(String(e.message))) throw e;
      try {
        body.sha = await fetchSha();
        await ghFetch(apiBase(cfg) + "/contents/" + apiPath, {
          method: "DELETE", headers: headers, body: JSON.stringify(body)
        });
      } catch (e2) {
        if (/HTTP 404/.test(String(e2.message))) return { deleted: false, missing: true };
        throw e2;
      }
    }
    /* drop our content-digest memory so a future re-publish of the same
       packageId is not mistaken for "already up to date" */
    try {
      var pid = name.replace(/\.iebpack\.json$/i, "");
      var reg2 = syncRegistry();
      if (reg2[pid]) { delete reg2[pid].contentHash; syncRegistrySet(pid, reg2[pid]); }
    } catch (e3) {}
    return { deleted: true, path: path };
  }

  /* expose the sync API on the global object (browsers) and via exports */
  function module_exports_sync() { return {
    DEFAULTS: SYNC_DEFAULTS, config: syncConfig, saveConfig: saveSyncConfig,
    listPacks: syncListPacks, downloadPack: syncDownloadPack, uploadPack: syncUploadPack,
    deletePack: syncDeletePack,
    pull: syncPull, pushPack: syncPushPack,
    registry: syncRegistry, registrySet: syncRegistrySet,
    uninstallPackLocal: uninstallPackLocal,
    contentDigest: contentDigest, packContentChanged: packContentChanged,
    rememberContent: rememberPackContent,
    rememberPackContent: rememberPackContent,
    listInstalled: listInstalledPacks, installPack: installPack };
  }
  if (typeof window !== "undefined") window.IEB_SYNC = module_exports_sync();

  return {
    FORMAT_VERSION: FORMAT_VERSION,
    TASK_TYPES: TASK_TYPES, TYPE_IDS: TYPE_IDS, MEDIA_ICONS: MEDIA_ICONS,
    defaultTask: defaultTask, blankTask: blankTask, generateWordGrid: generateWordGrid,
    generateCrosswords: generateCrosswords,
    slugify: slugify, makeId: makeId,
    validateTask: validateTask, validateBook: validateBook, validateManifest: validateManifest,
    buildPack: buildPack, readPack: readPack,
    packFingerprint: packFingerprint, decidePackAction: decidePackAction, mergeBooks: mergeBooks,
    starterDraft: starterDraft,
    SYNC_DEFAULTS: SYNC_DEFAULTS, syncConfig: syncConfig, saveSyncConfig: saveSyncConfig,
    syncRawUrl: rawUrl, syncApiBase: apiBase, ghFetch: ghFetch,
    syncListPacks: syncListPacks, syncDownloadPack: syncDownloadPack, syncUploadPack: syncUploadPack,
    syncResolveHubBranch: syncResolveHubBranch,
    syncResolveDefaultBranch: syncResolveHubBranch,
    syncRegistry: syncRegistry, syncRegistrySet: syncRegistrySet, syncPull: syncPull,
    syncPushPack: syncPushPack, sync: module_exports_sync()
  };
});
