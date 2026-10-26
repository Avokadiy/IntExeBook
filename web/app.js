/* ============================================================
   IntExeBook — front-end (vanilla JS, hash-based routing)
   Flow:  #/                      -> choose textbook
          #/tb/<id>               -> choose Student's Book / Workbook
          #/tb/<id>/<slot>        -> choose Unit
          #/tb/<id>/<slot>/<unit> -> choose Lesson
          #/tb/<id>/<slot>/<unit>/<lesson>          -> choose Task
          #/tb/<id>/<slot>/<unit>/<lesson>/play/<task> -> interactive player
   ============================================================ */
"use strict";

const app = document.getElementById("app");
const crumbsEl = document.getElementById("crumbs");

// simple in-memory caches so "back" navigation is instant
const bookCache = {};   // "id/slot" -> book tree
const taskCache = {};   // full url  -> task json

/* When the UI is opened directly from disk (file://) there is no local
   server; the same JSON textbooks are then read straight from the folder. */
const FILE_MODE = location.protocol === "file:";
const API = (p) => FILE_MODE ? p.replace(/^\//, "") : p;

async function getJSON(url) {
  const res = await fetch(API(url));
  if (!res.ok) {
    let msg = "";
    try { msg = (await res.json()).error; } catch (e) { /* ignore */ }
    throw new Error(msg || ("HTTP " + res.status));
  }
  return res.json();
}

/* Read a file relative to web/ when running in file:// mode.
   Chrome blocks XHR on file:// but <script> tags still load, so we have a
   fallback that turns the JSON file into a global variable. */
let jsonpCounter = 0;
function loadLocalFile(relPath) {
  return fetch(API(relPath)).then(r => {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }).catch(() => new Promise((resolve, reject) => {
    const cb = "__iebJsonp" + (++jsonpCounter);
    const s = document.createElement("script");
    const timer = setTimeout(() => { cleanup(); reject(new Error("Cannot load " + relPath)); }, 5000);
    function cleanup() {
      clearTimeout(timer);
      delete window[cb];
      s.remove();
    }
    window[cb] = (data) => { cleanup(); resolve(data); };
    // appends "?__iebJsonp=N" — the browser ignores the query on file:// URLs
    s.src = API(relPath) + (relPath.includes("?") ? "&" : "?") + "__ieb_cb=" + cb;
    s.onerror = () => { cleanup(); reject(new Error("Cannot load " + relPath)); };
    document.head.appendChild(s);
  }));
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function navigate(hash) { location.hash = hash; }

/* ------------------------------------------------------------ breadcrumbs */
function renderCrumbs(items) {
  crumbsEl.innerHTML = "";
  items.forEach((it, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "sep"; sep.textContent = "›";
      crumbsEl.appendChild(sep);
    }
    if (i === items.length - 1) {
      const cur = document.createElement("span");
      cur.className = "current"; cur.textContent = it.label;
      crumbsEl.appendChild(cur);
    } else {
      const b = document.createElement("button");
      b.textContent = it.label;
      b.onclick = () => navigate(it.href);
      crumbsEl.appendChild(b);
    }
  });
}

/* ------------------------------------------------------------ router */
async function route() {
  const parts = decodeURIComponent(location.hash.replace(/^#\/?/, "")).split("/").filter(Boolean);
  /* authoring pages live in web/authoring.js; guard against a missing /
     half-loaded script so the router never dies with "not defined" */
  const authoring = () => {
    if (typeof window.renderCreate !== "function")
      throw new Error("The authoring module failed to load — check that shared.js and authoring.js are served correctly.");
  };
  try {
    if (parts[0] === "create") { authoring(); return window.renderCreate(); }
    if (parts[0] === "import") { authoring(); return window.renderImport(); }
    if (parts[0] === "import-zip") { authoring(); return window.renderImportZip(); }
    if (parts[0] === "edit" && parts[1] === "task" && parts.length >= 2) {
      authoring();
      return window.renderEditor({ mode: "task", tbId: parts[2], slot: parts[3], unitId: parts[4], lessonId: parts[5], taskId: parts[6] });
    }
    if (parts[0] === "edit" && parts[1] === "lesson" && parts.length >= 2) {
      authoring();
      return window.renderEditor({ mode: "lesson", tbId: parts[2], slot: parts[3], unitId: parts[4], lessonId: parts[5] });
    }
    if (parts[0] === "edit" && parts[1] === "unit" && parts.length >= 2) {
      authoring();
      return window.renderEditor({ mode: "unit", tbId: parts[2], slot: parts[3], unitId: parts[4] });
    }
    if (parts[0] === "edit" && parts[1] === "book" && parts.length >= 2) {
      authoring();
      return window.renderEditor({ mode: "book", tbId: parts[2], slot: parts[3] });
    }
    if (parts[0] === "edit") { authoring(); return window.renderEditor({ mode: "new" }); }
    if (parts.length === 0) return viewTextbooks();
    if (parts[0] === "tb" && parts.length === 2) return viewBooks(parts[1]);
    if (parts[0] === "tb" && parts.length === 3) return viewUnits(parts[1], parts[2]);
    if (parts[0] === "tb" && parts.length === 4) return viewLessons(parts[1], parts[2], parts[3]);
    if (parts[0] === "tb" && parts.length === 5) return viewTasks(parts[1], parts[2], parts[3], parts[4]);
    if (parts[0] === "tb" && parts.length === 7 && parts[5] === "play")
      return viewPlayer(parts[1], parts[2], parts[3], parts[4], parts[6]);
    viewNotFound();
  } catch (e) {
    app.innerHTML = `<div class="error-box">⚠️ ${esc(e.message)}</div>`;
  }
}
window.addEventListener("hashchange", route);
document.getElementById("brandHome").onclick = (ev) => { ev.preventDefault(); navigate("#/"); };

/* ------------------------------------------------------------ dark theme */
const THEME_KEY = "ieb-theme";
const themeBtn = document.getElementById("themeToggle");
function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
function paintThemeButton() {
  if (!themeBtn) return;
  const dark = currentTheme() === "dark";
  themeBtn.textContent = dark ? "☀️" : "🌙";
  themeBtn.title = dark ? "Switch to light theme" : "Switch to dark theme";
}
if (themeBtn) {
  themeBtn.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
    paintThemeButton();
  });
  paintThemeButton();
}

/* ------------------------------------------------------- one-button sync */
const syncBtn = document.getElementById("syncBtn");
let syncing = false;
function toast(msg, kind) {
  let el = document.getElementById("edToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "edToast";
    el.className = "ed-toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = "ed-toast show" + (kind ? " " + kind : "");
  clearTimeout(el._h);
  el._h = setTimeout(() => { el.className = "ed-toast"; }, 7000);
}
/* small settings dialog for the sync target — lets teachers change/renew
   the token and point at another repo/branch without touching localStorage */
async function syncSettingsDialog(SYNC) {
  const cfg = SYNC.config();
  const mask = t => t ? t.slice(0, 12) + "…" : "(not set)";
  const what = prompt(
    "⚙ Sync settings\n" +
    "GitHub token [current: " + mask(cfg.token) + "] — leave empty to keep, type '-' to remove:\n" +
    "Repository owner [current: " + cfg.owner + "] — leave empty to keep:\n" +
    "Repository name [current: " + cfg.repo + "] — leave empty to keep:\n" +
    "Branch [current: " + cfg.branch + "] — leave empty to keep:",
    "\n\n\n\n");
  if (what == null) return false;               /* cancelled */
  const parts = what.split("\n").map(s => s.trim());
  const next = Object.assign({}, cfg);
  if (parts[0]) next.token = parts[0] === "-" ? "" : parts[0];
  if (parts[1]) next.owner = parts[1];
  if (parts[2]) next.repo = parts[2];
  if (parts[3]) next.branch = parts[3];
  SYNC.saveConfig(next);
  toast("⚙ Sync settings saved", "ok");
  return true;
}

async function doSync(reconfigure) {
  if (syncing) return;
  const SYNC = window.IEB_SYNC || (window.IEB_SHARED && window.IEB_SHARED.sync);
  if (!SYNC) { toast("Sync module is not loaded", "bad"); return; }
  if (reconfigure) { if (!await syncSettingsDialog(SYNC)) return; }
  const cfg = SYNC.config();
  if (!cfg.token) {
    const tok = prompt("Paste your GitHub token to enable sharing.\nIt is stored only in this browser (localStorage).\nYou can leave it empty to just browse shared courses read-only:");
    if (tok != null) { cfg.token = tok.trim(); SYNC.saveConfig(cfg); }
  }
  syncing = true;
  syncBtn.disabled = true;
  const oldLabel = syncBtn.textContent;
  try {
    syncBtn.textContent = "⏳ Updating…";
    const res = await SYNC.pull((done, total, name) => {
      syncBtn.textContent = "⏳ " + done + "/" + total;
    });
    const bits = [];
    if (res.added.length)   bits.push("＋ new: " + res.added.join(", "));
    if (res.updated.length) bits.push("↻ updated: " + res.updated.join(", "));
    if (res.merged.length)  bits.push("🤝 merged (changes of several teachers combined): " + res.merged.join(", "));
    if (res.skipped.length) bits.push("＝ already up to date: " + res.skipped.length + " course(s)");
    /* nothing was actually changed this run — say exactly why instead of a
       fake “all courses updated” success */
    if (!res.added.length && !res.updated.length && !res.merged.length && !res.skipped.length) {
      if (res.note) bits.push("(" + res.note + ")");
      else if (!res.errors.length) bits.push("Nothing changed.");
    }
    if (res.offline)        bits.push("(offline — showing last known list, nothing was installed)");
    if (res.errors.length)  bits.push("⚠ " + res.errors.join("; "));
    const ok = !res.errors.length && (res.added.length + res.updated.length + res.merged.length > 0);
    toast("🔄 Sync finished\n" + bits.join("\n"), res.errors.length ? "bad" : (ok ? "ok" : "warn"));
    invalidateCachesAndRefresh();
    /* courses are installed now — re-check the beacon so the red light goes
       quiet as soon as nothing is pending anymore */
    refreshSyncBeacon(true);
  } catch (e) {
    const msg = String(e && e.message || e);
    /* auth/config problems -> offer to change the token right away */
    if (/token|401|403|Bad credentials|rejected/i.test(msg)) {
      if (confirm(msg + "\n\nOpen sync settings to paste a new token?")) { doSync(true); return; }
    }
    toast("Sync failed: " + msg, "bad");
  } finally {
    syncing = false;
    syncBtn.disabled = false;
    syncBtn.textContent = oldLabel;
  }
}
function invalidateCachesAndRefresh() {
  Object.keys(bookCache).forEach(k => delete bookCache[k]);
  Object.keys(taskCache).forEach(k => delete taskCache[k]);
  route();
}
if (syncBtn) {
  syncBtn.addEventListener("click", () => doSync(false));
  /* right-click / long-press opens the settings dialog (change token etc.) */
  syncBtn.addEventListener("contextmenu", (ev) => { ev.preventDefault(); doSync(true); });
  syncBtn.title = "Update shared exercises. Right-click → sync settings (change token, repo, branch).";
}

/* --------------------------------------------- blinking red update beacon
   A small red light next to the "🔄 Update" button blinks whenever the
   shared-exercises folder on GitHub contains a course that is new or has
   changed since the last sync/publish performed on THIS machine.
   Detection lives in web/shared.js (checkForNewCourses): it lists the hub
   via one GitHub API call and compares each file's git SHA against the SHA
   we recorded when we last installed or pushed that exact revision. The
   result is cached for 5 minutes; checks run at startup, every 10 minutes,
   on tab re-focus and right after a sync — silent failures keep the last
   known state so the light never flickers off because of a hiccup. */
const syncBeacon = document.getElementById("syncBeacon");
let beaconBusy = false;
async function refreshSyncBeacon(force) {
  if (!syncBeacon || beaconBusy) return;
  const SYNC = window.IEB_SYNC || (window.IEB_SHARED && window.IEB_SHARED.sync);
  if (!SYNC || typeof SYNC.checkForNewCourses !== "function") return;
  beaconBusy = true;
  try {
    const res = await SYNC.checkForNewCourses(!!force);
    const n = (res && res.pending && res.pending.length) || 0;
    if (n > 0) {
      syncBeacon.hidden = false;
      const names = res.pending.map(p => p.name.replace(/\.iebpack\.json$/i, "")).slice(0, 6).join(", ");
      syncBeacon.title = "🔴 New or updated courses in the repository (" + n + "): " + names +
                         "\nClick \"🔄 Update\" to download them.";
    } else {
      syncBeacon.hidden = true;
      syncBeacon.removeAttribute("title");
    }
  } catch (e) { /* offline/auth trouble — leave the light as it is */ }
  beaconBusy = false;
}
refreshSyncBeacon(false);                                  /* check on startup */
setInterval(() => refreshSyncBeacon(false), 10 * 60 * 1000); /* …and every 10 min */
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshSyncBeacon(false);            /* …and on tab focus */
});

/* ------------------------------------------------------------ helpers */
async function loadBookMeta(tbId) {
  const all = FILE_MODE ? await loadFileModeIndex() : await getJSON("/api/textbooks");
  const tb = all.textbooks.find(t => t.id === tbId || t.folder === tbId);
  if (!tb) throw new Error("Textbook not found: " + tbId);
  return tb;
}
async function loadBook(tbId, slot) {
  const key = tbId + "/" + slot;
  if (bookCache[key]) return bookCache[key];
  if (FILE_MODE) {
    const tb = await loadBookMeta(tbId);
    const book = await loadLocalFile(`../textbooks/${tb.folder}/${slot}.json`);
    book.book_label = tb[slot] || (slot === "student" ? "Student's Book" : "Workbook");
    book.textbook_title = tb.title || "";
    for (const u of book.units || []) for (const l of u.lessons || [])
      l.task_count = (l.tasks || []).length;
    bookCache[key] = book;
    return book;
  }
  bookCache[key] = await getJSON(`/api/textbooks/${encodeURIComponent(tbId)}/book/${slot}`);
  return bookCache[key];
}
/* Full untrimmed book (task bodies included) — used by the editor. */
async function loadBookRaw(tbId, slot) {
  if (FILE_MODE) {
    const tb = await loadBookMeta(tbId);
    try {
      return await loadLocalFile(`../textbooks/${tb.folder}/${slot}.json`);
    } catch (e) {
      const book = await loadBook(tbId, slot); // file:// fallback: tree only
      return JSON.parse(JSON.stringify(book));
    }
  }
  return getJSON(`/api/textbooks/${encodeURIComponent(tbId)}/raw/${slot}`);
}
/* Single task: the server endpoint returns it on its own; in file:// mode we
   simply pick it out of the already-loaded book tree. */
async function loadTask(tbId, slot, unitId, lessonId, taskId) {
  if (FILE_MODE) {
    const book = await loadBook(tbId, slot);
    const unit = findUnit(book, unitId);
    const lesson = unit && findLesson(unit, lessonId);
    const task = ((lesson && lesson.tasks) || []).find(t => t.id === taskId);
    if (!task) throw new Error("Task not found: " + taskId);
    return Object.assign({}, task, { book_label: book.book_label, textbook_title: book.textbook_title });
  }
  const url = `/api/textbooks/${encodeURIComponent(tbId)}/task/${slot}/${encodeURIComponent(unitId)}/${encodeURIComponent(lessonId)}/${encodeURIComponent(taskId)}`;
  if (!taskCache[url]) taskCache[url] = getJSON(url).catch(e => { delete taskCache[url]; throw e; });
  return taskCache[url];
}
function findUnit(book, unitId) { return book.units.find(u => u.id === unitId); }
function findLesson(unit, lessonId) { return (unit.lessons || []).find(l => l.id === lessonId); }

/* ------------------------------------------------------------ quick search */
async function runSearch(query) {
  if (FILE_MODE) {
    // no server: build a tiny index from the book trees and filter it locally
    const data = await loadFileModeIndex();
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    const hit = t => tokens.every(x => String(t || "").toLowerCase().includes(x));
    const enc = encodeURIComponent;
    const out = [];
    for (const tb of data.textbooks) {
      const tbHash = `#/tb/${enc(tb.folder || tb.id)}`;
      if (hit(tb.title) || hit(tb.subtitle) || hit(tb.level))
        out.push({ kind: "textbook", icon: tb.icon || "📕", title: tb.title, subtitle: tb.subtitle || "", hash: tbHash });
      for (const slot of ["student", "workbook"]) {
        if (!tb[slot]) continue;
        let book;
        try { book = await loadBook(tb.folder || tb.id, slot); } catch (e) { continue; }
        for (const u of book.units || []) {
          const uHash = `${tbHash}/${slot}/${enc(u.id)}`;
          if (hit(u.title)) out.push({ kind: "unit", icon: "📚", title: u.title, subtitle: `${tb.title} · ${book.book_label}`, hash: uHash });
          for (const l of u.lessons || []) {
            const lHash = `${uHash}/${enc(l.id)}`;
            if (hit(l.title)) out.push({ kind: "lesson", icon: "📖", title: l.title, subtitle: `${tb.title} · ${u.title} · ${book.book_label}`, hash: lHash });
            for (const t of l.tasks || [])
              if (hit(t.title)) out.push({ kind: "task", icon: TYPE_ICONS[t.type] || "⭐", title: t.title, subtitle: `${tb.title} · ${l.title} · ${book.book_label}`, hash: `${lHash}/play/${enc(t.id)}` });
          }
        }
      }
    }
    return out.slice(0, 60);
  }
  const res = await getJSON("/api/search?q=" + encodeURIComponent(query));
  return res.results || [];
}

let searchTimer = null;
function initSearch() {
  const input = document.getElementById("searchBox");
  const box = document.getElementById("searchResults");
  if (!input || !box) return;
  function close() { box.classList.add("hidden"); }
  async function run() {
    const q = input.value.trim();
    if (q.length < 2) return close();
    let results;
    try { results = await runSearch(q); }
    catch (e) {
      box.innerHTML = `<div class="sr-empty">Search needs the local server — start the app with <b>start.bat</b>.</div>`;
      box.classList.remove("hidden");
      return;
    }
    if (!results.length) {
      box.innerHTML = `<div class="sr-empty">Nothing found for “${esc(q)}”.</div>`;
      box.classList.remove("hidden");
      return;
    }
    box.innerHTML = "";
    results.forEach(r => {
      const item = document.createElement("button");
      item.className = "sr-item";
      item.innerHTML = `<span class="sr-icon">${esc(r.icon)}</span>
        <span><span class="sr-title">${esc(r.title)}</span>
        <span class="sr-sub">${esc(r.kind)} · ${esc(r.subtitle)}</span></span>`;
      item.onclick = () => { navigate(r.hash); close(); input.value = ""; input.blur(); };
      box.appendChild(item);
    });
    box.classList.remove("hidden");
  }
  input.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(run, 150); });
  input.addEventListener("focus", () => { if (input.value.trim().length >= 2) run(); });
  input.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  document.addEventListener("click", e => { if (!box.contains(e.target) && e.target !== input) close(); });
}

/* ============================================================ Step 1 */

/* ---- textbook list for file:// mode (no local server available) ----
   The browser cannot list directory contents on the local disk, so we use a
   pre-generated manifest: web/textbooks-index.js.  If it is missing or stale,
   we fall back to probing textbooks/<name>/manifest.json directly. */
let fileModeIndex = null;
async function loadFileModeIndex() {
  if (fileModeIndex) return fileModeIndex;
  let data = null;
  try {
    await loadLocalFile("textbooks-index.js");   // executes window.IEB_TEXTBOOKS
    if (Array.isArray(window.IEB_TEXTBOOKS)) data = { textbooks: window.IEB_TEXTBOOKS };
  } catch (e) { /* index missing – fall through to probing */ }
  if (!data || !Array.isArray(data.textbooks) || !data.textbooks.length) {
    const KNOWN = ["pep-primary-3", "cambridge-kidslife1"];
    const results = await Promise.allSettled(KNOWN.map(async f => {
      const m = await loadLocalFile(`../textbooks/${f}/manifest.json`);
      return Object.assign({ folder: f, id: m.id || f }, m);
    }));
    data = { textbooks: results.filter(r => r.status === "fulfilled").map(r => r.value) };
  }
  fileModeIndex = data;
  return data;
}

async function viewTextbooks() {
  renderCrumbs([{ label: "🏠 Textbooks", href: "#/" }]);
  app.innerHTML = `
    <section>
      <div class="hero">
        <h1>Interactive tasks in seconds</h1>
        <p>Pick a textbook, choose a lesson and turn any exercise into a live,
           interactive activity your students can solve right in class.</p>
      </div>
      <h2 class="step-title"><span class="stepnum">1</span> Choose a textbook</h2>
      <div class="grid" id="textbookGrid"><div class="loading">Loading textbooks…</div></div>
      <div class="hint-card">
        <strong>📂 Modular system:</strong> to add a new textbook just drop its folder
        (or a <code>.zip</code> / <code>.tar.gz</code> archive) into the
        <code>textbooks/</code> directory of the app and refresh this page.
        Folders starting with <code>_</code> are ignored — see <code>textbooks/_TEMPLATE/</code>
        for the file format.
      </div>
    </section>`;
  const grid = document.getElementById("textbookGrid");
  let textbooks;
  if (FILE_MODE) {
    try {
      textbooks = (await loadFileModeIndex()).textbooks;
    } catch (e) { textbooks = []; }
  } else {
    textbooks = (await getJSON("/api/textbooks")).textbooks;
  }
  textbooks.forEach(tb => {
    tb.books = tb.books || ["student", "workbook"].filter(s => tb[s]).map(s => ({ slot: s, label: tb[s] }));
  });
  if (!textbooks.length) {
    grid.innerHTML = FILE_MODE
      ? `<div class="error-box">Your browser cannot read the <code>textbooks/</code> folder directly.
         Please start IntExeBook by double-clicking <b>start.bat</b> (Windows) or <b>start.sh</b> (Mac/Linux),
         or use the ready-made <b>IntExeBook.exe</b> desktop app.</div>`
      : `<div class="error-box">No textbooks found. Drop a textbook folder or archive into <code>textbooks/</code>.</div>`;
    return;
  }
  grid.innerHTML = "";
  textbooks.forEach(tb => {
    const card = document.createElement("div");
    card.className = "card" + (tb.error ? " broken" : "");
    const color = tb.color || "#6366f1";
    card.innerHTML = `
      <div class="tb-cover" style="background:linear-gradient(135deg, ${esc(color)}, ${esc(color)}bb)">${esc(tb.icon || "📕")}</div>
      <h3>${esc(tb.title)}</h3>
      <div class="subtitle">${esc(tb.subtitle || "")}</div>
      ${tb.level ? `<span class="badge level">${esc(tb.level)}</span>` : ""}
      ${(tb.books || []).map(b => `<span class="badge">${esc(b.label)}</span>`).join("")}
      ${tb.error ? `<p class="desc" style="color:#b91c1c">⚠ ${esc(tb.error)}</p>`
                 : `<p class="desc">${esc(tb.description || "")}</p>`}`;
    if (!tb.error) card.onclick = () => navigate(`#/tb/${encodeURIComponent(tb.folder || tb.id)}`);
    grid.appendChild(card);
  });
}

/* ============================================================ Step 2 */
async function viewBooks(tbId) {
  const tb = await loadBookMeta(tbId);
  renderCrumbs([
    { label: "🏠 Textbooks", href: "#/" },
    { label: tb.title, href: `#/tb/${encodeURIComponent(tbId)}` },
  ]);
  app.innerHTML = `
    <span class="backlink" onclick="location.hash='#/'">← All textbooks</span>
    <h2 class="step-title"><span class="stepnum">2</span> What are we using today?</h2>
    <div class="book-choice" id="bookChoice"></div>`;
  const wrap = document.getElementById("bookChoice");
  const icons = { student: "📗", workbook: "📝" };
  const descs = {
    student: "Exercises from the main pupil's book — great for presenting new language together.",
    workbook: "Extra practice pages — perfect for individual work and homework checks.",
  };
  (tb.books || []).forEach(b => {
    const card = document.createElement("div");
    card.className = "card book-card";
    card.innerHTML = `<span class="big">${icons[b.slot] || "📘"}</span>
      <h3>${esc(b.label)}</h3><p class="desc">${descs[b.slot] || ""}</p>`;
    card.onclick = () => navigate(`#/tb/${encodeURIComponent(tbId)}/${b.slot}`);
    wrap.appendChild(card);
  });
  if (!(tb.books || []).length) wrap.innerHTML = `<div class="error-box">This textbook has no books configured in its manifest.</div>`;
}

/* ============================================================ Step 3a: units */
async function viewUnits(tbId, slot) {
  const [tb, book] = await Promise.all([loadBookMeta(tbId), loadBook(tbId, slot)]);
  renderCrumbs([
    { label: "🏠 Textbooks", href: "#/" },
    { label: tb.title, href: `#/tb/${encodeURIComponent(tbId)}` },
    { label: book.book_label, href: `#/tb/${encodeURIComponent(tbId)}/${slot}` },
  ]);
  app.innerHTML = `
    <span class="backlink" data-back="#/tb/${encodeURIComponent(tbId)}">← ${esc(tb.title)}</span>
    <h2 class="step-title"><span class="stepnum">3</span> Choose a Unit <small style="color:var(--muted);font-size:15px">· ${esc(book.book_label)}</small></h2>
    <div class="grid units" id="unitGrid"></div>`;
  bindBackLinks();
  const grid = document.getElementById("unitGrid");
  const color = tb.color || "#6366f1";
  book.units.forEach((u, idx) => {
    const nLess = (u.lessons || []).length;
    const nTasks = (u.lessons || []).reduce((s, l) => s + (l.task_count || (l.tasks || []).length), 0);
    const card = document.createElement("div");
    card.className = "card unit-card";
    card.innerHTML = `
      <div class="num" style="background:linear-gradient(135deg,${esc(color)},${esc(color)}aa)">${idx + 1}</div>
      <h3>${esc(u.title)}</h3>
      <div class="subtitle">${nLess} lesson${nLess !== 1 ? "s" : ""} · ${nTasks} task${nTasks !== 1 ? "s" : ""}</div>`;
    card.onclick = () => navigate(`#/tb/${encodeURIComponent(tbId)}/${slot}/${encodeURIComponent(u.id)}`);
    grid.appendChild(card);
  });
}

/* ============================================================ Step 3b: lessons */
async function viewLessons(tbId, slot, unitId) {
  const [tb, book] = await Promise.all([loadBookMeta(tbId), loadBook(tbId, slot)]);
  const unit = findUnit(book, unitId);
  if (!unit) throw new Error("Unit not found: " + unitId);
  renderCrumbs([
    { label: "🏠 Textbooks", href: "#/" },
    { label: tb.title, href: `#/tb/${encodeURIComponent(tbId)}` },
    { label: book.book_label, href: `#/tb/${encodeURIComponent(tbId)}/${slot}` },
    { label: unit.title, href: location.hash },
  ]);
  app.innerHTML = `
    <span class="backlink" data-back="#/tb/${encodeURIComponent(tbId)}/${slot}">← Units</span>
    <h2 class="step-title"><span class="stepnum">3</span> Choose a Lesson <small style="color:var(--muted);font-size:15px">· ${esc(unit.title)}</small></h2>
    <div class="lesson-list" id="lessonList"></div>`;
  bindBackLinks();
  const list = document.getElementById("lessonList");
  (unit.lessons || []).forEach((l, i) => {
    const row = document.createElement("div");
    row.className = "lesson-row";
    row.innerHTML = `
      <div>
        <strong style="font-size:17px">${esc(l.title)}</strong>
        <div class="meta">${l.page ? "p. " + esc(l.page) + " · " : ""}${(l.tasks || []).length} interactive task${(l.tasks || []).length !== 1 ? "s" : ""}</div>
      </div>
      <button class="btn btn-primary" style="padding:9px 18px;font-size:14px">Open →</button>`;
    row.onclick = () => navigate(`#/tb/${encodeURIComponent(tbId)}/${slot}/${encodeURIComponent(unitId)}/${encodeURIComponent(l.id)}`);
    list.appendChild(row);
  });
}

/* ============================================================ Step 4: tasks */
var TYPE_ICONS = {
  "multiple-choice": "🔤", "true-false": "☑️", "gap-fill": "✏️",
  "word-order": "🧩", "matching": "🔗", "choose-odd-one-out": "🎯",
  "find-and-click": "🔍", "click-on-picture": "🖱️", "word-search": "🔠",
  "translate-match": "🌍",
};

/* ---------- media attachments (images / audio / video) ----------
   A task may carry "media": [ { "type": "image|audio|video", "src":
   "assets/farm.mp3", "caption": "optional" } ].  Relative sources are
   served by the local backend at /assets/<book>/...; in file:// mode they
   resolve against the textbook folder next to web/. */
const MEDIA_TAGS = { image: "🖼️", audio: "🎧", video: "🎬" };
/* Media sources in task JSON are relative to the textbook folder, e.g.
   "assets/farm.wav".  Normalize them so they work no matter which
   identifier ended up in the URL (folder name or manifest id) and whether
   a manifest already used an absolute "/assets/..." path. */
function normalizeMediaSrc(src) {
  let s = String(src || "").replace(/\\/g, "/").replace(/^\/+/, "");
  // strip a leading "<something>/" when the next segment is "assets"
  s = s.replace(/^[^/]+\/(?=assets\/)/, "");
  return s;
}
function mediaSrc(tbId, src) {
  if (/^(https?:|data:)/.test(src)) return src;
  const norm = normalizeMediaSrc(src);
  const rel = "../textbooks/" + encodeURIComponent(tbId) + "/" + norm;
  return FILE_MODE ? rel : "/assets/" + encodeURIComponent(tbId) + "/" + norm;
}
function hasMedia(task) {
  return Array.isArray(task.media) && task.media.length > 0;
}
function firstMedia(task) {
  return hasMedia(task) ? (task.media[0] || null) : null;
}
function mediaHtml(task, tbId) {
  if (!hasMedia(task)) return "";
  const items = task.media.map(m => {
    const src = mediaSrc(tbId, m.src || "");
    const cap = m.caption ? `<figcaption>${esc(m.caption)}</figcaption>` : "";
    if (m.type === "audio")
      return `<figure class="media-item"><audio controls preload="metadata" src="${esc(src)}"></audio>${cap}</figure>`;
    if (m.type === "video")
      return `<figure class="media-item"><video controls preload="metadata" src="${esc(src)}"></video>${cap}</figure>`;
    return `<figure class="media-item"><img loading="lazy" src="${esc(src)}" alt="${esc(m.caption || "")}">${cap}</figure>`;
  }).join("");
  return `<div class="task-media">${items}</div>`;
}
async function viewTasks(tbId, slot, unitId, lessonId) {
  const [tb, book] = await Promise.all([loadBookMeta(tbId), loadBook(tbId, slot)]);
  const unit = findUnit(book, unitId);
  const lesson = unit && findLesson(unit, lessonId);
  if (!lesson) throw new Error("Lesson not found: " + lessonId);
  renderCrumbs([
    { label: "🏠 Textbooks", href: "#/" },
    { label: tb.title, href: `#/tb/${encodeURIComponent(tbId)}` },
    { label: book.book_label, href: `#/tb/${encodeURIComponent(tbId)}/${slot}` },
    { label: unit.title, href: `#/tb/${encodeURIComponent(tbId)}/${slot}/${encodeURIComponent(unitId)}` },
    { label: lesson.title, href: location.hash },
  ]);
  app.innerHTML = `
    <span class="backlink" data-back="#/tb/${encodeURIComponent(tbId)}/${slot}/${encodeURIComponent(unitId)}">← Lessons</span>
    <h2 class="step-title"><span class="stepnum">4</span> Choose a task <small style="color:var(--muted);font-size:15px">· ${esc(lesson.title)}</small></h2>
    <div class="grid" id="taskGrid"></div>`;
  bindBackLinks();
  const grid = document.getElementById("taskGrid");
  (lesson.tasks || []).forEach((t, i) => {
    const card = document.createElement("div");
    card.className = "card";
    card.style.cursor = "pointer";
    card.innerHTML = `
      <div style="font-size:34px;margin-bottom:8px">${TYPE_ICONS[t.type] || "⭐"}</div>
      <span class="badge">${esc(t.type || "task")}</span>
      ${firstMedia(t) ? `<span class="badge media-badge">${MEDIA_TAGS[firstMedia(t).type] || "🎬"} media</span>` : ""}
      <h3>${i + 1}. ${esc(t.title || "Untitled task")}</h3>`;
    card.onclick = () => navigate(`#/tb/${encodeURIComponent(tbId)}/${slot}/${encodeURIComponent(unitId)}/${encodeURIComponent(lessonId)}/play/${encodeURIComponent(t.id)}`);
    grid.appendChild(card);
  });
}
function bindBackLinks() {
  document.querySelectorAll(".backlink[data-back]").forEach(el =>
    el.onclick = () => navigate(el.dataset.back));
}

/* ============================================================ Player */
async function viewPlayer(tbId, slot, unitId, lessonId, taskId) {
  const [tb, book] = await Promise.all([loadBookMeta(tbId), loadBook(tbId, slot)]);
  const unit = findUnit(book, unitId);
  const lesson = unit && findLesson(unit, lessonId);
  if (!lesson) throw new Error("Lesson not found");
  const task = await loadTask(tbId, slot, unitId, lessonId, taskId);

  const tasks = lesson.tasks || [];
  const idx = Math.max(0, tasks.findIndex(t => t.id === taskId));

  renderCrumbs([
    { label: "🏠 Textbooks", href: "#/" },
    { label: tb.title, href: `#/tb/${encodeURIComponent(tbId)}` },
    { label: book.book_label, href: `#/tb/${encodeURIComponent(tbId)}/${slot}` },
    { label: unit.title, href: `#/tb/${encodeURIComponent(tbId)}/${slot}/${encodeURIComponent(unitId)}` },
    { label: lesson.title, href: `#/tb/${encodeURIComponent(tbId)}/${slot}/${encodeURIComponent(unitId)}/${encodeURIComponent(lessonId)}` },
    { label: task.title || "Task", href: location.hash },
  ]);

  app.innerHTML = `
    <div class="player">
      <div class="task-head">
        <div>
          <div class="badge">${esc(task.type)}</div>
          <h2>${esc(task.title || "Task")}</h2>
        </div>
        <div class="progress-dots" id="dots"></div>
      </div>
      <p class="instr">${esc(task.instruction || "")}</p>
      ${mediaHtml(task, tbId)}
      <div id="body"></div>
      <div class="feedback" id="feedback"></div>
      <div class="check-row">
        <button class="btn btn-ghost" id="btnPrev" ${idx === 0 ? "disabled" : ""}>← Previous</button>
        <div style="display:flex;gap:12px">
          <button class="btn btn-ghost" id="btnRetry" style="display:none">↺ Try again</button>
          <button class="btn btn-primary" id="btnNext" disabled>${idx === tasks.length - 1 ? "Finish ✓" : "Next →"}</button>
        </div>
      </div>
    </div>`;

  const dotsEl = document.getElementById("dots");
  const state = { results: new Array(tasks.length).fill(null) };
  function drawDots() {
    dotsEl.innerHTML = "";
    tasks.forEach((_, i) => {
      const d = document.createElement("span");
      d.className = "pdot" + (i === idx ? " current" : "") +
        (state.results[i] === true ? " done-ok" : state.results[i] === false ? " done-bad" : "");
      dotsEl.appendChild(d);
    });
  }
  drawDots();

  const body = document.getElementById("body");
  const feedback = document.getElementById("feedback");
  const btnNext = document.getElementById("btnNext");
  const btnRetry = document.getElementById("btnRetry");
  const btnPrev = document.getElementById("btnPrev");

  const goHash = (delta) => {
    const ni = idx + delta;
    if (ni >= 0 && ni < tasks.length)
      navigate(`#/tb/${encodeURIComponent(tbId)}/${slot}/${encodeURIComponent(unitId)}/${encodeURIComponent(lessonId)}/play/${encodeURIComponent(tasks[ni].id)}`);
  };
  btnPrev.onclick = () => goHash(-1);
  btnNext.onclick = () => {
    if (idx < tasks.length - 1) goHash(1);
    else showResults();
  };
  btnRetry.onclick = () => renderEngine.reset();

  function setFeedback(ok, text) {
    state.results[idx] = ok;
    drawDots();
    feedback.className = "feedback " + (ok ? "ok" : "bad");
    feedback.innerHTML = (ok ? "🎉 Correct! " : "❌ Not quite. ") +
      (text ? `<div class="explain">${esc(text)}</div>` : "");
    btnNext.disabled = false;
    btnRetry.style.display = ok ? "none" : "inline-flex";
  }

  function showResults() {
    const answered = state.results.filter(r => r !== null);
    const correct = answered.filter(r => r === true).length;
    const total = tasks.length;
    const pct = total ? Math.round(100 * correct / total) : 0;
    const emoji = pct >= 80 ? "🏆" : pct >= 50 ? "👍" : "💪";
    app.querySelector(".player").innerHTML = `
      <div class="result-screen">
        <div class="emoji">${emoji}</div>
        <h2>Lesson complete!</h2>
        <div class="score-line">${esc(lesson.title)} — <b>${correct}</b> out of <b>${total}</b> correct (${pct}%)</div>
        <div class="actions">
          <button class="btn btn-ghost" id="againBtn">↺ Play again</button>
          <button class="btn btn-primary" id="moreBtn">Choose another task</button>
        </div>
      </div>`;
    document.getElementById("againBtn").onclick = () => { route(); };
    document.getElementById("moreBtn").onclick = () =>
      navigate(`#/tb/${encodeURIComponent(tbId)}/${slot}/${encodeURIComponent(unitId)}/${encodeURIComponent(lessonId)}`);
  }

  /* ---------- engines per task type (shared with the authoring preview) ----------
     makeRenderEngine(ctx) runs one of the five interactive engines against
     ctx.task and renders it into ctx.body. The player builds a full context;
     the editor's "Preview" tab passes a minimal one (see web/authoring.js). */
  function makeRenderEngine(ctx) {
    const body = ctx.body, task = ctx.task;
    const feedback = ctx.feedback, btnNext = ctx.btnNext, btnRetry = ctx.btnRetry;
    const state = ctx.state, idx = ctx.idx || 0;
    const drawDots = ctx.drawDots || function () {};
    let renderEngine = { reset() {} };

    function setFeedback(ok, text) {
      state.results[idx] = ok;
      drawDots();
      feedback.className = "feedback " + (ok ? "ok" : "bad");
      feedback.innerHTML = (ok ? "\ud83c\udf89 Correct! " : "\u274c Not quite. ") +
        (text ? `<div class="explain">${esc(text)}</div>` : "");
      if (btnNext) btnNext.disabled = false;
      if (btnRetry) btnRetry.style.display = ok ? "none" : "inline-flex";
    }

    /* multiple choice */
    function engineMC() {
      let locked = false;
      body.innerHTML = "";
      (task.options || []).forEach((opt, i) => {
        const b = document.createElement("button");
        b.className = "opt-btn";
        b.innerHTML = `<b>${String.fromCharCode(65 + i)}.</b>&nbsp; ${esc(opt)}`;
        b.onclick = () => {
          if (locked) return;
          locked = true;
          const ok = i === task.answerIndex;
          [...body.children].forEach((el, j) => {
            el.disabled = true;
            if (j === task.answerIndex) el.classList.add("correct");
            else if (j === i) el.classList.add("wrong");
            else el.classList.add("dim");
          });
          setFeedback(ok, ok ? "" : (task.explanation || `The correct answer is \u201c${task.options[task.answerIndex]}\u201d.`));
        };
        body.appendChild(b);
      });
      renderEngine.reset = () => { locked = false; feedback.innerHTML = ""; if (btnNext) btnNext.disabled = true; if (btnRetry) btnRetry.style.display = "none"; engineMC(); };
    }

    /* true / false */
    function engineTF() {
      let locked = false;
      const wrap = document.createElement("div");
      wrap.className = "tf-wrap";
      [[true, "TRUE \u2714"], [false, "FALSE \u2718"]].forEach(([val, label]) => {
        const b = document.createElement("button");
        b.className = "tf-btn";
        b.textContent = label;
        b.onclick = () => {
          if (locked) return;
          locked = true;
          const ok = val === !!task.answer;
          b.classList.add(ok ? "correct" : "wrong");
          wrap.children.forEach(ch => { ch.disabled = true; if (ch !== b && !ok) ch.classList.add("correct"); });
          setFeedback(ok, ok ? "" : (task.explanation || `The correct answer is ${task.answer ? "TRUE" : "FALSE"}.`));
        };
        wrap.appendChild(b);
      });
      body.appendChild(wrap);
      renderEngine.reset = () => { locked = false; feedback.innerHTML = ""; if (btnNext) btnNext.disabled = true; if (btnRetry) btnRetry.style.display = "none"; engineTF(); };
    }

    /* gap fill */
    function engineGap() {
      const norm = s => String(s).trim().toLowerCase().replace(/[.,!?;]+$/g, "").replace(/\s+/g, " ");
      const blanks = task.blanks || [];
      const html = esc(task.text || "").replace(/_{2,}/g,
        () => `<input class="gap-input" type="text" autocomplete="off">`);
      body.innerHTML = `<div class="gap-text">${html}</div>`;
      const inputs = [...body.querySelectorAll(".gap-input")];
      inputs.forEach((inp, i) => {
        const hint = blanks[i] && blanks[i].hint;
        inp.insertAdjacentHTML("afterend",
          hint ? ` <span class="hint-link" title="${esc(hint)}">\ud83d\udca1 hint</span>` : " ");
      });
      body.querySelectorAll(".hint-link").forEach((hl, i) => {
        hl.onclick = () => alert("\ud83d\udca1 " + (blanks[i].hint || ""));
      });
      const check = () => {
        let allOk = true;
        inputs.forEach((inp, i) => {
          const answers = (blanks[i] && blanks[i].answers) || [];
          const ok = answers.some(a => norm(a) === norm(inp.value));
          inp.classList.toggle("correct", ok);
          inp.classList.toggle("wrong", !ok);
          if (!ok) allOk = false;
        });
        if (!allOk) inputs.forEach(inp => { if (inp.classList.contains("wrong")) setTimeout(() => inp.select(), 0); });
        const solution = blanks.map(b => (b.answers || [""])[0]).join(", ");
        setFeedback(allOk, allOk ? "" : (task.explanation || `Possible answers: ${solution}.`));
      };
      const bar = document.createElement("div");
      bar.style.marginTop = "18px";
      bar.innerHTML = `<button class="btn btn-primary" style="padding:10px 22px;font-size:15px">Check answers \u2713</button>`;
      bar.querySelector("button").onclick = check;
      body.appendChild(bar);
      inputs[inputs.length - 1] && (inputs[inputs.length - 1].addEventListener("keydown", e => { if (e.key === "Enter") check(); }));
      renderEngine.reset = () => { feedback.innerHTML = ""; if (btnNext) btnNext.disabled = true; if (btnRetry) btnRetry.style.display = "none"; engineGap(); };
    }

    /* word order */
    function engineWO() {
      const words = (task.words || []).slice();
      const answerTokens = String(task.answer || words.join(" ")).split(/\s+/).filter(Boolean);
      const shuffled = words.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      if (shuffled.join("|") === answerTokens.join("|") && shuffled.length > 1) shuffled.reverse();
      let placed = [];
      function draw() {
        body.innerHTML = `
          <div class="wo-sentence" id="woSent"><span style="color:#94a3b8" id="woPlaceholder">Tap the words below to build the sentence\u2026</span></div>
          <div class="wo-pool" id="woPool"></div>`;
        const sent = document.getElementById("woSent");
        const pool = document.getElementById("woPool");
        placed.forEach((pi, pos) => {
          const chip = document.createElement("button");
          chip.className = "wo-word in-sentence";
          chip.textContent = shuffled[pi];
          chip.onclick = () => { if (!sent.classList.contains("graded")) { placed.splice(pos, 1); draw(); } };
          sent.appendChild(chip);
        });
        shuffled.forEach((w, i) => {
          if (placed.includes(i)) return;
          const chip = document.createElement("button");
          chip.className = "wo-word";
          chip.textContent = w;
          chip.onclick = () => { if (!sent.classList.contains("graded")) { placed.push(i); draw(); } };
          pool.appendChild(chip);
        });
        const ready = placed.length === shuffled.length;
        if (!document.getElementById("woCheck")) {
          const bar = document.createElement("div");
          bar.id = "woCheck"; bar.style.marginTop = "18px";
          bar.innerHTML = `<button class="btn btn-primary" style="padding:10px 22px;font-size:15px" ${ready ? "" : "disabled"}>Check \u2713</button>`;
          bar.querySelector("button").onclick = check;
          body.appendChild(bar);
        } else {
          document.getElementById("woCheck").querySelector("button").disabled = !ready;
        }
      }
      function check() {
        const user = placed.map(i => shuffled[i]);
        const normTok = t => t.toLowerCase().replace(/[.?!,]+$/, "");
        const ok = user.length === answerTokens.length &&
          user.every((w, i) => normTok(w) === normTok(answerTokens[i]));
        const sent = document.getElementById("woSent");
        sent.classList.add("graded");
        [...sent.children].forEach((chip, pos) => {
          chip.classList.add(normTok(user[pos]) === normTok(answerTokens[pos]) ? "correct" : "wrong");
        });
        setFeedback(ok, ok ? "" : (task.explanation || `Correct sentence: \u201c${answerTokens.join(" ")}\u201d.`));
      }
      draw();
      renderEngine.reset = () => { placed = []; feedback.innerHTML = ""; if (btnNext) btnNext.disabled = true; if (btnRetry) btnRetry.style.display = "none"; draw(); };
    }

    /* matching */
    function engineMatch() {
      const pairs = (task.pairs || []).map((p, i) => ({ ...p, pid: i }));
      const rights = pairs.slice();
      for (let i = rights.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rights[i], rights[j]] = [rights[j], rights[i]];
      }
      let selLeft = null, matched = 0;
      body.innerHTML = `
        <div class="match-grid">
          <div class="match-col" id="colL"></div>
          <div class="match-col" id="colR"></div>
        </div>`;
      const colL = document.getElementById("colL"), colR = document.getElementById("colR");
      pairs.forEach(p => {
        const el = document.createElement("div");
        el.className = "match-item"; el.textContent = p.left; el.dataset.pid = p.pid;
        el.onclick = () => pick("L", p.pid, el);
        colL.appendChild(el);
      });
      rights.forEach(p => {
        const el = document.createElement("div");
        el.className = "match-item"; el.textContent = p.right; el.dataset.pid = p.pid;
        el.onclick = () => pick("R", p.pid, el);
        colR.appendChild(el);
      });
      function pick(side, pid, el) {
        if (el.classList.contains("locked")) return;
        if (side === "L") {
          if (selLeft && selLeft.el !== el) selLeft.el.classList.remove("selected");
          selLeft = (selLeft && selLeft.el === el) ? null : { pid, el };
          el.classList.toggle("selected", !!selLeft && selLeft.el === el);
          return;
        }
        if (!selLeft) { el.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }], { duration: 250 }); return; }
        const leftEl = selLeft.el;
        if (selLeft.pid === pid) {
          leftEl.classList.remove("selected");
          leftEl.classList.add("locked-ok", "locked");
          el.classList.add("locked-ok", "locked");
          matched++;
          if (matched === pairs.length) {
            const hadMistake = state.results[idx] === false;
            setFeedback(!hadMistake, "");
          }
        } else {
          el.classList.add("locked-bad"); leftEl.classList.add("locked-bad");
          leftEl.classList.remove("selected");
          state.results[idx] = false; drawDots();
          setTimeout(() => {
            el.classList.remove("locked-bad"); leftEl.classList.remove("locked-bad");
          }, 600);
        }
        selLeft = null;
      }
      renderEngine.reset = () => {
        selLeft = null; matched = 0;
        feedback.innerHTML = ""; if (btnNext) btnNext.disabled = true; if (btnRetry) btnRetry.style.display = "none";
        engineMatch();
      };
    }

    /* choose the odd ones out — tap everything that does NOT belong */
    function engineOdd() {
      let locked = false, done = false;
      const opts = (task.options || []).map((o, i) => ({ text: o.text, isOdd: !!o.isOdd, pid: i }));
      const shuffled = opts.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      body.innerHTML = `<div class="odd-grid" id="oddGrid"></div>` +
        `<div class="odd-status" id="oddStatus">Tap every word that doesn't belong${task.categoryHint ? " to “" + esc(task.categoryHint) + "”" : ""}.</div>` +
        `<div style="margin-top:16px"><button class="btn btn-primary" id="oddCheck" style="padding:10px 22px;font-size:15px">Check ✓</button></div>`;
      const grid = document.getElementById("oddGrid");
      const chosen = new Set();
      shuffled.forEach(o => {
        const b = document.createElement("button");
        b.className = "odd-btn"; b.textContent = o.text; b.dataset.pid = o.pid;
        b.onclick = () => {
          if (locked || done) return;
          if (chosen.has(o.pid)) { chosen.delete(o.pid); b.classList.remove("picked"); }
          else { chosen.add(o.pid); b.classList.add("picked"); }
        };
        grid.appendChild(b);
      });
      document.getElementById("oddCheck").onclick = () => {
        if (done) return;
        locked = true; done = true;
        const want = opts.filter(o => o.isOdd).map(o => o.pid);
        const ok = chosen.size === want.length && want.every(p => chosen.has(p));
        [...grid.children].forEach(el => {
          const pid = Number(el.dataset.pid);
          el.disabled = true;
          const isOdd = opts[pid] && opts[pid].isOdd;
          if (isOdd) el.classList.add(chosen.has(pid) ? "correct" : "missed");
          else if (chosen.has(pid)) el.classList.add("wrong");
        });
        const oddWords = opts.filter(o => o.isOdd).map(o => o.text).join(", ");
        setFeedback(ok, ok ? "" : (task.explanation || `The odd one(s) out: ${oddWords}.`));
      };
      renderEngine.reset = () => { locked = false; done = false; chosen.clear(); feedback.innerHTML = ""; if (btnNext) btnNext.disabled = true; if (btnRetry) btnRetry.style.display = "none"; engineOdd(); };
    }

    /* find & click words in a sentence */
    function engineFindClick() {
      const norm = s => String(s).toLowerCase().replace(/[.,!?;:"'’“”]+/g, "");
      const targets = new Set((task.targets || []).map(norm));
      const tokens = String(task.text || "").split(/(\s+)/);
      body.innerHTML = `<div class="fc-text" id="fcText"></div><div class="odd-status" id="fcStatus">Find and click: <b>${(task.targets || []).map(esc).join(", ")}</b></div>`;
      const host = document.getElementById("fcText");
      let foundCount = 0, graded = false;
      const need = targets.size;
      tokens.forEach(tok => {
        if (!tok || /^\s+$/.test(tok)) { host.appendChild(document.createTextNode(tok)); return; }
        const clean = norm(tok);
        const span = document.createElement("span");
        span.className = "fc-word"; span.textContent = tok;
        span.onclick = () => {
          if (graded) return;
          if (targets.has(clean)) {
            if (span.classList.contains("found")) return;
            span.classList.add("found"); foundCount++;
            if (foundCount >= need) {
              graded = true;
              setFeedback(true, task.explanation || "");
            }
          } else {
            span.classList.add("miss");
            setTimeout(() => span.classList.remove("miss"), 600);
            state.results[idx] = false; drawDots();
          }
        };
        host.appendChild(span);
      });
      renderEngine.reset = () => { graded = false; foundCount = 0; feedback.innerHTML = ""; if (btnNext) btnNext.disabled = true; if (btnRetry) btnRetry.style.display = "none"; engineFindClick(); };
    }

    /* click on picture — hotspot finder.  In the authoring preview (ctx.edit)
       the engine only draws the picture + a placeholder; the editor overlays
       its own numbered, draggable-free placement dots. */
    function enginePicture() {
      const imgSrc = ctx.tbId != null && typeof mediaSrc === "function" ? mediaSrc(ctx.tbId, task.image || "") : (task.image || "");
      if (ctx.edit) {
        body.innerHTML = `
          <div class="pic-wrap ed-pic-edit">
            <img class="pic-target" src="${esc(imgSrc)}" alt="" draggable="false">
            ${imgSrc ? "" : `<div class="ed-pic-missing">No picture yet — upload one in the ✍ Content tab.</div>`}
          </div>`;
        return;
      }
      const spots = (task.hotspots || []).map((s, i) => ({ ...s, hit: false, pid: i }));
      body.innerHTML = `
        <div class="pic-wrap" id="picWrap">
          <img class="pic-target" src="${esc(imgSrc)}" alt="" draggable="false">
        </div>
        <div class="odd-status" id="picStatus">Click on: <b>${spots.map(s => esc(s.label)).join(", ")}</b></div>`;
      const wrap = document.getElementById("picWrap");
      let wrongTries = 0, graded = false;
      spots.forEach(s => {
        const dot = document.createElement("button");
        dot.className = "pic-dot"; dot.title = "?";
        dot.style.left = s.x + "%"; dot.style.top = s.y + "%";
        dot.style.width = (s.r || 8) + "%"; dot.style.height = (s.r || 8) + "%";
        dot.onclick = (e) => {
          e.stopPropagation();
          if (graded || s.hit) return;
          s.hit = true; dot.classList.add("hit"); dot.textContent = "✓";
          if (spots.every(x => x.hit)) { graded = true; setFeedback(wrongTries === 0, task.explanation || ""); }
        };
        wrap.appendChild(dot);
      });
      wrap.addEventListener("click", (e) => {
        if (graded || e.target !== wrap && !e.target.classList.contains("pic-target")) return;
        wrongTries++;
        state.results[idx] = false; drawDots();
        wrap.classList.add("shake");
        setTimeout(() => wrap.classList.remove("shake"), 400);
      });
      renderEngine.reset = () => { graded = false; wrongTries = 0; spots.forEach(s => s.hit = false); feedback.innerHTML = ""; if (btnNext) btnNext.disabled = true; if (btnRetry) btnRetry.style.display = "none"; enginePicture(); };
    }

    /* word search — click letters to trace hidden words */
    function engineWordSearch() {
      const rows = (task.grid || []).map(r => String(r).toUpperCase());
      const words = (task.words || []).map(w => w.toUpperCase()).filter(Boolean);
      if (!rows.length || !words.length) {
        body.innerHTML = `<div class="error-box">This word search has no grid yet — ask the teacher to regenerate it in the editor.</div>`;
        if (btnNext) btnNext.disabled = false;
        return;
      }
      // precompute where each word lives so clicks can be validated
      const positions = {}; // word -> array of [y,x]
      const dirs = [[0, 1], [1, 0], [1, 1], [-1, 1]];
      words.forEach(w => {
        outer:
        for (let y = 0; y < rows.length; y++) for (let x = 0; x < (rows[y] || "").length; x++) {
          for (const [dy, dx] of dirs) {
            let ok = true;
            for (let k = 0; k < w.length; k++) {
              const cy = y + dy * k, cx = x + dx * k;
              if (cy < 0 || cx < 0 || cy >= rows.length || cx >= rows[cy].length || rows[cy][cx] !== w[k]) { ok = false; break; }
            }
            if (ok) {
              positions[w] = [];
              for (let k = 0; k < w.length; k++) positions[w].push([y + dy * k, x + dx * k]);
              continue outer;
            }
          }
        }
      });
      body.innerHTML = `<div class="ws-grid" id="wsGrid"></div>
        <div class="ws-legend" id="wsLegend"></div>`;
      const gridEl = document.getElementById("wsGrid");
      const legendEl = document.getElementById("wsLegend");
      gridEl.style.gridTemplateColumns = `repeat(${Math.max(...rows.map(r => r.length))}, minmax(0,1fr))`;
      const cellEls = [];
      rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const c = document.createElement("button");
          c.className = "ws-cell"; c.textContent = row[x]; c.dataset.y = y; c.dataset.x = x;
          c.onclick = () => pick(y, x, c);
          gridEl.appendChild(c);
          (cellEls[y] = cellEls[y] || {})[x] = c;
        }
      });
      const remaining = words.filter(w => positions[w]).slice();
      words.filter(w => !positions[w]).forEach(w => { /* not placeable — mark as found anyway */ });
      let chain = [];
      function sameCell(a, b) { return a[0] === b[0] && a[1] === b[1]; }
      function clearChain() { chain.forEach(([y, x]) => cellEls[y] && cellEls[y][x] && cellEls[y][x].classList.remove("sel")); chain = []; }
      function pick(y, x, el) {
        if (el.classList.contains("found") || !remaining.length) return;
        if (chain.some(p => sameCell(p, [y, x]))) { clearChain(); return; }
        if (chain.length) {
          const last = chain[chain.length - 1];
          const dy = y - last[0], dx = x - last[1];
          if (!(Math.abs(dy) <= 1 && Math.abs(dx) <= 1 && (dy || dx))) { clearChain(); }
        }
        chain.push([y, x]); el.classList.add("sel");
        const typed = chain.map(([cy, cx]) => rows[cy][cx]).join("");
        const hit = remaining.find(w => w === typed);
        if (hit) {
          chain.forEach(([cy, cx]) => { const ce = cellEls[cy][cx]; ce.classList.remove("sel"); ce.classList.add("found"); });
          chain = [];
          remaining.splice(remaining.indexOf(hit), 1);
          redrawLegend();
          if (!remaining.length) setFeedback(state.results[idx] !== false, task.note ? "Words: " + task.note : "");
        } else if (!remaining.some(w => w.startsWith(typed))) {
          state.results[idx] = false; drawDots();
          clearChain();
        }
      }
      function redrawLegend() {
        legendEl.innerHTML = "";
        words.forEach(w => {
          const chip = document.createElement("span");
          chip.className = "ws-word" + (remaining.includes(w) ? "" : " crossed");
          chip.textContent = w;
          legendEl.appendChild(chip);
        });
      }
      redrawLegend();
      renderEngine.reset = () => { clearChain(); feedback.innerHTML = ""; if (btnNext) btnNext.disabled = true; if (btnRetry) btnRetry.style.display = "none"; engineWordSearch(); };
    }

    /* translate & match — same mechanic as matching, kept separate so its
       data can evolve (audio hints etc.) without touching classic matching */
    function engineTranslateMatch() {
      const pairs = (task.pairs || []).map((p, i) => ({ ...p, pid: i }));
      const rights = pairs.slice();
      for (let i = rights.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rights[i], rights[j]] = [rights[j], rights[i]];
      }
      let selLeft = null, matched = 0;
      body.innerHTML = `
        <div class="match-grid tm-grid">
          <div class="match-col" id="tmL"></div>
          <div class="match-col" id="tmR"></div>
        </div>`;
      const colL = document.getElementById("tmL"), colR = document.getElementById("tmR");
      pairs.forEach(p => {
        const el = document.createElement("div");
        el.className = "match-item"; el.textContent = p.left; el.dataset.pid = p.pid;
        el.onclick = () => pick("L", p.pid, el);
        colL.appendChild(el);
      });
      rights.forEach(p => {
        const el = document.createElement("div");
        el.className = "match-item"; el.textContent = p.right; el.dataset.pid = p.pid;
        el.onclick = () => pick("R", p.pid, el);
        colR.appendChild(el);
      });
      function pick(side, pid, el) {
        if (el.classList.contains("locked")) return;
        if (side === "L") {
          if (selLeft && selLeft.el !== el) selLeft.el.classList.remove("selected");
          selLeft = (selLeft && selLeft.el === el) ? null : { pid, el };
          el.classList.toggle("selected", !!selLeft && selLeft.el === el);
          return;
        }
        if (!selLeft) { el.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }], { duration: 250 }); return; }
        const leftEl = selLeft.el;
        if (selLeft.pid === pid) {
          leftEl.classList.remove("selected");
          leftEl.classList.add("locked-ok", "locked");
          el.classList.add("locked-ok", "locked");
          matched++;
          if (matched === pairs.length) {
            const hadMistake = state.results[idx] === false;
            setFeedback(!hadMistake, "");
          }
        } else {
          el.classList.add("locked-bad"); leftEl.classList.add("locked-bad");
          leftEl.classList.remove("selected");
          state.results[idx] = false; drawDots();
          setTimeout(() => { el.classList.remove("locked-bad"); leftEl.classList.remove("locked-bad"); }, 600);
        }
        selLeft = null;
      }
      renderEngine.reset = () => {
        selLeft = null; matched = 0;
        feedback.innerHTML = ""; if (btnNext) btnNext.disabled = true; if (btnRetry) btnRetry.style.display = "none";
        engineTranslateMatch();
      };
    }

    switch (task.type) {
      case "multiple-choice": engineMC(); break;
      case "true-false": engineTF(); break;
      case "gap-fill": engineGap(); break;
      case "word-order": engineWO(); break;
      case "matching": engineMatch(); break;
      case "choose-odd-one-out": engineOdd(); break;
      case "find-and-click": engineFindClick(); break;
      case "click-on-picture": enginePicture(); break;
      case "word-search": engineWordSearch(); break;
      case "translate-match": engineTranslateMatch(); break;
      default:
        body.innerHTML = `<div class="error-box">Task type \u201c${esc(task.type)}\u201d is not supported yet.</div>`;
        if (btnNext) btnNext.disabled = false;
    }
    return renderEngine;
  }
  window.renderTaskEngine = makeRenderEngine;

  let renderEngine = makeRenderEngine({ body, task, feedback, btnNext, btnRetry, state, idx, drawDots });
}

function viewNotFound() {
  app.innerHTML = `<div class="error-box">Page not found. <a href="#/">Go home</a></div>`;
}

/* ============================================================
   AUTHORING — teachers create / edit exercises themselves
   (web/authoring.js provides: renderCreate, renderImport, renderEditor)
   ============================================================ */

/* ============================================================
   SHARED HELPERS — exported for web/authoring.js.
   app.js runs in strict mode inside its own classic-script scope,
   so top-level const/function declarations are NOT properties of
   window; authoring.js needs them through this bridge instead.
   ============================================================ */
window.IEB_APP = {
  app, crumbsEl, bookCache, taskCache, FILE_MODE, API,
  getJSON, loadLocalFile, esc, navigate, renderCrumbs, route,
  loadBookMeta, loadBook, loadBookRaw, loadTask, loadFileModeIndex,
  findUnit, findLesson, mediaSrc, normalizeMediaSrc, mediaHtml,
};

/* ============================================================
   EASTER EGG — the Konami code. ↑↑↓↓←→←→BA anywhere on the page
   unlocks a hidden "founder" mode. Nothing in the UI hints at it;
   only those who know will find it.
   ============================================================ */
(function () {
  const SEQ = ["ArrowUp","ArrowUp","ArrowDown","ArrowDown","ArrowLeft","ArrowRight","ArrowLeft","ArrowRight","b","a"];
  let pos = 0, unlocked = sessionStorage.getItem("ieb-egg") === "1";
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === SEQ[pos]) { pos++; } else { pos = (key === SEQ[0]) ? 1 : 0; }
    if (pos === SEQ.length) { pos = 0; activateEgg(); }
  });

  function activateEgg() {
    if (unlocked) { toast("🥚 Already unlocked — the full show plays again now."); }
    else {
      unlocked = true;
      try { sessionStorage.setItem("ieb-egg", "1"); } catch (err) {}
      toast("🕹️ Konami accepted. Founder mode engaging…");
    }
    /* sparkle the brand + version badge (permanent after unlock) */
    const brand = document.getElementById("brandHome");
    if (brand) {
      brand.textContent = "✨ 📖 IntExeBook";
      brand.title = "You found it.";
      if (!brand._akBound) { brand.addEventListener("click", founderMode); brand._akBound = true; }
    }
    const ver = document.getElementById("appVersion");
    if (ver) ver.textContent = "v1.0 · akkaki edition";
    /* the FULL show fires immediately — no extra click needed */
    founderMode();
  }
  if (unlocked && document.readyState !== "loading") {
    const b = document.getElementById("brandHome");
    if (b) { b.textContent = "✨ 📖 IntExeBook"; b.addEventListener("click", founderMode); }
    const v = document.getElementById("appVersion");
    if (v) v.textContent = "v1.0 · akkaki edition";
  } else if (unlocked) {
    document.addEventListener("DOMContentLoaded", activateEggSilently, { once: true });
  }
  function activateEggSilently() {
    const b = document.getElementById("brandHome");
    if (b) { b.textContent = "✨ 📖 IntExeBook"; b.title = "You found it."; b.addEventListener("click", founderMode); }
    const v = document.getElementById("appVersion");
    if (v) v.textContent = "v1.0 · akkaki edition";
  }

  function founderMode(e) {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    if (document.getElementById("akkaki-overlay")) { exitFounder(); return; }
    document.documentElement.dataset.founder = "1";

    /* ---- matrix rain canvas (behind everything, full screen) ---- */
    const cv = document.createElement("canvas");
    cv.id = "ak-rain";
    cv.style.cssText = "position:fixed;inset:0;z-index:9998;pointer-events:none;opacity:.5";
    document.body.appendChild(cv);
    const ctx = cv.getContext("2d");
    let W, H, cols, drops;
    const GLYPHS = "Akkaki✦◆▚▞ΞΔΣΩλφψ01αβγ📖✨🎧";
    function resize() {
      W = cv.width = innerWidth; H = cv.height = innerHeight;
      cols = Math.floor(W / 18); drops = Array.from({ length: cols }, () => (Math.random() * -H / 18) | 0);
    }
    resize(); addEventListener("resize", resize);
    let raf, last = 0;
    (function loop(t) {
      raf = requestAnimationFrame(loop);
      if (t - last < 45) return; last = t;
      ctx.fillStyle = "rgba(5,8,18,.16)"; ctx.fillRect(0, 0, W, H);
      ctx.font = "15px monospace";
      for (let i = 0; i < cols; i++) {
        const ch = GLYPHS[(Math.random() * GLYPHS.length) | 0];
        const x = i * 18, y = drops[i] * 18;
        ctx.fillStyle = ch === "A" || ch === "k" ? "#f472b6" : (Math.random() > .92 ? "#ffffff" : "#818cf8");
        ctx.fillText(ch, x, y);
        if (y > H && Math.random() > .975) drops[i] = 0;
        drops[i]++;
      }
    })(0);

    /* ---- glitch hero overlay ---- */
    const ov = document.createElement("div");
    ov.id = "akkaki-overlay";
    ov.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,rgba(30,20,60,.55),rgba(5,8,18,.85));backdrop-filter:blur(4px);cursor:pointer;animation:akFade .4s ease";
    ov.innerHTML = `
      <div style="text-align:center;color:#fff;font-family:inherit">
        <div class="ak-cube-wrap"><div class="ak-cube">
          <span class="f f1">📖</span><span class="f f2">✨</span><span class="f f3">🎧</span>
          <span class="f f4">🎬</span><span class="f f5">⭐</span><span class="f f6">🛠</span>
        </div></div>
        <div class="ak-glitch" data-text="AKKAKI">AKKAKI</div>
        <div style="margin-top:14px;font-size:15px;letter-spacing:6px;text-transform:uppercase;background:linear-gradient(90deg,#818cf8,#c084fc,#f472b6,#818cf8);background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:akFlow 2.5s linear infinite">founder mode engaged</div>
        <div style="margin-top:16px;font-size:12px;opacity:.6">click anywhere to return to the library · press Konami again to hide the sparkle</div>
      </div>`;
    ov.addEventListener("click", exitFounder);
    const st = document.createElement("style");
    st.id = "ak-style";
    st.textContent = `
@keyframes akFlow{to{background-position:300% 0}}
@keyframes akFade{from{opacity:0}}
@keyframes akCube{0%{transform:rotateX(-20deg) rotateY(0)}100%{transform:rotateX(-20deg) rotateY(360deg)}}
@keyframes akGlitch{0%,86%,100%{transform:none;text-shadow:2px 0 #f472b6,-2px 0 #22d3ee}88%{transform:translateX(-6px) skewX(-8deg);text-shadow:8px 0 #f472b6,-8px 0 #22d3ee}90%{transform:translateX(6px);text-shadow:-6px 2px #f472b6,6px -2px #22d3ee}92%{transform:translateX(-3px) skewX(6deg)}}
.ak-glitch{position:relative;display:inline-block;margin-top:26px;font-size:56px;font-weight:900;letter-spacing:10px;color:#fff;text-shadow:2px 0 #f472b6,-2px 0 #22d3ee;animation:akGlitch 2.2s steps(1) infinite}
.ak-glitch::before,.ak-glitch::after{content:attr(data-text);position:absolute;left:0;top:0;width:100%;overflow:hidden}
.ak-glitch::before{color:#f472b6;transform:translate(-3px,-2px);clip-path:polygon(0 0,100% 0,100% 32%,0 32%);opacity:.85}
.ak-glitch::after{color:#22d3ee;transform:translate(3px,2px);clip-path:polygon(0 68%,100% 68%,100% 100%,0 100%);opacity:.85}
.ak-cube-wrap{perspective:700px;display:inline-block}
.ak-cube{position:relative;width:70px;height:70px;margin:0 auto;transform-style:preserve-3d;animation:akCube 6s linear infinite}
.ak-cube .f{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:34px;background:rgba(129,140,248,.12);border:1px solid rgba(167,139,250,.5);box-shadow:0 0 22px rgba(129,140,248,.35) inset}
.f1{transform:translateZ(35px)}.f2{transform:rotateY(90deg) translateZ(35px)}.f3{transform:rotateY(180deg) translateZ(35px)}
.f4{transform:rotateY(-90deg) translateZ(35px)}.f5{transform:rotateX(90deg) translateZ(35px)}.f6{transform:rotateX(-90deg) translateZ(35px)}
html[data-founder="1"] body{animation:akHue 8s linear infinite}
@keyframes akHue{to{filter:hue-rotate(360deg)}}
html[data-founder="1"] .app-version{background:linear-gradient(90deg,#f472b6,#818cf8)!important;-webkit-background-clip:text;background-clip:text;color:transparent!important;font-weight:800}`;
    document.head.appendChild(st);
    document.body.appendChild(ov);

    /* ---- emoji + glyph confetti burst ---- */
    const pieces = ["📖","✨","🎧","🎬","⭐","🛠","∎","◆","✦"];
    for (let i = 0; i < 60; i++) {
      const s = document.createElement("span");
      s.textContent = pieces[(Math.random() * pieces.length) | 0];
      const drift = (Math.random() * 40 - 20) | 0;
      s.style.cssText = `position:fixed;left:${Math.random()*100}vw;top:-6vh;z-index:10000;font-size:${12+Math.random()*26}px;pointer-events:none;transition:transform ${2.4+Math.random()*2.6}s cubic-bezier(.2,.6,.3,1),opacity 4s`;
      document.body.appendChild(s);
      requestAnimationFrame(() => { s.style.transform = `translate(${drift}vw,115vh) rotate(${(Math.random()*1080-540)|0}deg)`; s.style.opacity = "0"; });
      setTimeout(() => s.remove(), 5500);
    }
    /* ---- secret console signature ---- */
    try {
      console.log("%c✦ AKKAKI ✦\n%cfounder of IntExeBook — you entered the code.\n↑↑↓↓←→←→BA",
        "font-size:28px;font-weight:900;background:linear-gradient(90deg,#818cf8,#f472b6);color:#fff;padding:6px 14px;border-radius:8px",
        "font-size:13px;color:#c084fc");
    } catch (err) {}
  }

  function exitFounder() {
    const ov = document.getElementById("akkaki-overlay"); if (ov) ov.remove();
    const cv = document.getElementById("ak-rain"); if (cv) cv.remove();
    delete document.documentElement.dataset.founder;
  }
})();

/* go! */
initSearch();
route();
