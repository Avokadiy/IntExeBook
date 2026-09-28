/* ============================================================
   IntExeBook — exercise authoring (teacher mode)

   #/create            landing page: new course / open pack / drafts
   #/import            install a shared .iebpack.json file
   #/edit/new          create a brand-new standalone course
   #/edit/book/<tb>/<slot>              edit the whole book (outline)
   #/edit/unit/<tb>/<slot>/<unit>       add lessons to one unit (topic)
   #/edit/lesson/<tb>/<slot>/<unit>/<lesson>   add tasks to one lesson
   #/edit/task/<tb>/<slot>/<unit>/<lesson>/<task>  edit a single task

   Everything works in two modes:
     * server mode  – saves straight into textbooks/ via the local API,
       so the course appears in the catalogue instantly and can be
       exported as a shareable ".iebpack.json" file;
     * file:// mode – no backend available: the editor still works and
       produces downloadable JSON files (student.json / manifest.json /
       .iebpack.json) that can be dropped into textbooks/.
   ============================================================ */
"use strict";

(function () {
  "use strict";
  const S = window.IEB_SHARED;
  if (!S) { console.error("shared.js is missing"); return; }
  /* helpers that live in app.js — classic scripts have separate scopes, so
     they are exported through the window.IEB_APP bridge (see end of app.js) */
  const A = window.IEB_APP || {};
  const app = A.app;
  const esc = A.esc;
  const API = A.API;
  const FILE_MODE = A.FILE_MODE;
  const getJSON = A.getJSON;
  const renderCrumbs = A.renderCrumbs;
  const loadBookMeta = A.loadBookMeta;
  const loadBookRaw = A.loadBookRaw;
  const bookCache = A.bookCache;
  const taskCache = A.taskCache;

  const LS_DRAFTS = "ieb-drafts";      // file:// fallback storage
  const MAX_ASSET = 12 * 1024 * 1024;  // 12 MB per media file in the browser

  /* ------------------------------------------------------ tiny DOM helpers */
  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else if (k === "checked") el.checked = !!v;
      else el.setAttribute(k, v);
    }
    (Array.isArray(children) ? children : children === undefined || children === null ? [] : [children])
      .forEach(c => el.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return el;
  }
  function input(value, onInput, attrs) {
    const el = h("input", Object.assign({ class: "ed-input", value: value == null ? "" : value }, attrs || {}));
    el.addEventListener("input", () => onInput(el.value));
    return el;
  }
  function textarea(value, onInput, rows) {
    const el = h("textarea", { class: "ed-input ed-textarea", rows: rows || 3 });
    el.value = value == null ? "" : value;
    el.addEventListener("input", () => onInput(el.value));
    return el;
  }
  function select(value, options, onChange) {
    const el = h("select", { class: "ed-input" });
    options.forEach(o => {
      const op = h("option", { value: o[0] }, o[1]);
      if (String(o[0]) === String(value)) op.selected = true;
      el.appendChild(op);
    });
    el.addEventListener("change", () => onChange(el.value));
    return el;
  }
  function btn(label, cls, onclick) {
    return h("button", { class: "btn " + (cls || "btn-ghost"), type: "button", onclick }, label);
  }
  function rowBtn(label, onclick, extraCls) {
    return h("button", { class: "ed-mini" + (extraCls ? " " + extraCls : ""), type: "button", onclick }, label);
  }

  function toast(msg, kind) {
    let t = document.getElementById("edToast");
    if (!t) {
      t = h("div", { id: "edToast", class: "ed-toast" });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = "ed-toast show" + (kind ? " " + kind : "");
    clearTimeout(t._h);
    t._h = setTimeout(() => { t.className = "ed-toast"; }, 3600);
  }

  /* ------------------------------------------------------ draft storage */
  function lsDrafts() {
    try { return JSON.parse(localStorage.getItem(LS_DRAFTS) || "{}"); }
    catch (e) { return {}; }
  }
  function lsSetDraft(name, payload) {
    const d = lsDrafts();
    d[name] = payload;
    try { localStorage.setItem(LS_DRAFTS, JSON.stringify(d)); } catch (e) { /* quota */ }
  }
  function lsDelDraft(name) {
    const d = lsDrafts(); delete d[name];
    try { localStorage.setItem(LS_DRAFTS, JSON.stringify(d)); } catch (e) { /* ignore */ }
  }

  async function api(method, url, body) {
    const res = await fetch(API(url), {
      method, headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) throw new Error((data && data.error) || ("HTTP " + res.status));
    return data;
  }

  /* ------------------------------------------------------ download helper */
  function download(filename, text) {
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ------------------------------------------------------ target model
     Where do the exercises go?
       standalone  – a brand-new course of its own
       existing    – appended to an already installed textbook (unit/lesson)
       topic       – a new unit ("topic") inside an existing textbook        */
  function targetSummary(target) {
    if (!target || target.mode === "standalone") {
      return { icon: "✨", title: "New standalone course", sub: "your own book, independent from any textbook" };
    }
    const names = { unit: "new topic (unit)", lesson: "existing lesson", book: "the book" };
    return {
      icon: "📚",
      title: "Into “" + (target.tbTitle || target.tbId) + "”",
      sub: "as a " + (names[target.kind] || "place") +
           (target.unitTitle ? " · " + target.unitTitle : "") +
           (target.lessonTitle ? " · " + target.lessonTitle : ""),
    };
  }

  /* ============================================================ #/create */
  async function renderCreate() {
    renderCrumbs([{ label: "🏠 Textbooks", href: "#/" }, { label: "🛠 Create exercises" }]);
    app.innerHTML = `
      <section>
        <div class="hero">
          <h1>Create &amp; share exercises</h1>
          <p>Every finished course lives in its own folder under
             <code>shared-exercises/&lt;course&gt;/</code> and is handed to
             colleagues as a single self-contained pack file — no hunting for
             who made what and where.</p>
        </div>
        <div class="grid" id="createGrid"></div>
        <h2 class="step-title"><span class="stepnum">⬇</span> Ready to publish</h2>
        <div class="lesson-list" id="publishedList"><div class="loading">Loading…</div></div>
        <h2 class="step-title"><span class="stepnum">·</span> Saved drafts</h2>
        <div class="lesson-list" id="draftList"><div class="loading">Loading…</div></div>
        <div class="hint-card">
          <strong>📦 How sharing works:</strong> when you press <b>Publish</b>, the
          course is saved into <code>shared-exercises/&lt;course&gt;/</code> — a
          normal textbook folder (manifest.json, student.json, assets/) that also
          produces <code>&lt;course&gt;.iebpack.json</code>: one file with all
          tasks <i>and</i> media inside. Send that file by chat / e-mail / USB —
          a colleague imports it and the course lands in their library instantly.
          Teachers editing different textbooks never touch each other's folders.
        </div>
      </section>`;

    const grid = document.getElementById("createGrid");
    const cards = [
      { icon: "✨", title: "New course", desc: "Start a standalone set of exercises with its own units and lessons.", act: () => location.hash = "#/edit/new" },
      { icon: "📕", title: "Add to a textbook", desc: "Attach new tasks to an existing unit, lesson or topic of any installed book.", act: () => pickTextbook() },
      { icon: "📥", title: "Import pack", desc: "Install a *.iebpack.json shared by another teacher.", act: () => location.hash = "#/import" },
    ];
    cards.forEach(c => {
      const card = h("div", { class: "card", style: "cursor:pointer" }, [
        h("div", { style: "font-size:34px;margin-bottom:8px" }, c.icon),
        h("h3", null, c.title),
        h("p", { class: "desc" }, c.desc),
      ]);
      card.onclick = c.act;
      grid.appendChild(card);
    });

    /* published courses living in shared-exercises/ */
    const pub = document.getElementById("publishedList");
    try {
      const list = await loadAllTextbooks();
      const mine = list.filter(tb => tb.source === "shared");
      if (!mine.length) {
        pub.innerHTML = `<div class="meta" style="color:var(--muted)">Nothing published yet — finish a course and press “Publish”, it will appear here.</div>`;
      } else {
        pub.innerHTML = "";
        mine.forEach(tb => {
          const row = h("div", { class: "lesson-row" }, [
            h("div", null, [
              h("strong", { style: "font-size:16px" }, (tb.icon || "📦") + " " + tb.title),
              h("div", { class: "meta" }, "shared-exercises/" + (tb.folder || tb.id) + (tb.level ? " · " + tb.level : "")),
            ]),
            h("div", { style: "display:flex;gap:8px" }, [
              rowBtn("Open", () => { location.hash = "#/tb/" + encodeURIComponent(tb.folder || tb.id); }),
              rowBtn("Edit", () => { location.hash = "#/edit/book/" + encodeURIComponent(tb.folder || tb.id) + "/student"; }),
              (() => { const b = rowBtn("📤 Pack", async () => {
                b.disabled = true; b.textContent = "…";
                try { await downloadPackFor(tb.folder || tb.id, tb.title); }
                catch (e) { toast("Export failed: " + e.message, "bad"); }
                finally { b.disabled = false; b.textContent = "📤 Pack"; }
              }); return b; })(),
            ]),
          ]);
          pub.appendChild(row);
        });
      }
    } catch (e) { pub.innerHTML = `<div class="meta" style="color:var(--muted)">Could not list published courses (${esc(e.message || e)}).</div>`; }

    const list = document.getElementById("draftList");
    let drafts = [];
    try { drafts = await listAllDrafts(); } catch (e) { console.warn("drafts:", e); }
    if (!list) return;
    if (!drafts.length) { list.innerHTML = `<div class="meta" style="color:var(--muted)">No drafts yet — they are saved automatically while you edit.</div>`; return; }
    list.innerHTML = "";
    drafts.forEach(d => {
      const row = h("div", { class: "lesson-row" }, [
        h("div", null, [
          h("strong", { style: "font-size:16px" }, d.title),
          h("div", { class: "meta" }, (d.updated ? d.updated.replace("T", " ").slice(0, 16) : "") +
            (d.stats && d.stats.tasks != null ? " · " + d.stats.tasks + " task(s)" : "")),
        ]),
        h("div", { style: "display:flex;gap:8px" }, [
          rowBtn("Open", () => openDraft(d.name)),
          rowBtn("✕", () => removeDraft(d.name)),
        ]),
      ]);
      list.appendChild(row);
    });
  }

  async function listAllDrafts() {
    let server = [];
    if (!FILE_MODE) {
      try { server = (await getJSON("/api/drafts")).drafts || []; } catch (e) { server = []; }
    }
    const local = Object.keys(lsDrafts()).map(k => {
      const d = lsDrafts()[k];
      return { name: k, title: (d.manifest && d.manifest.title) || k, updated: d.updated, stats: d.stats };
    });
    const seen = {}; const out = [];
    server.concat(local).forEach(d => {
      if (seen[d.name]) return; seen[d.name] = 1; out.push(d);
    });
    out.sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));
    return out;
  }

  async function openDraft(name) {
    let payload = null;
    if (!FILE_MODE) { try { payload = await getJSON("/api/drafts/" + encodeURIComponent(name)); } catch (e) { /* fall through */ } }
    if (!payload) payload = lsDrafts()[name];
    if (!payload) return toast("Draft not found", "bad");
    startSession(payload, name);
  }
  async function removeDraft(name) {
    if (!confirm("Delete this draft?")) return;
    lsDelDraft(name);
    if (!FILE_MODE) { try { await api("DELETE", "/api/drafts/" + encodeURIComponent(name)); } catch (e) { /* ignore */ } }
    renderCreate();
  }

  function pickTextbook() {
    loadAllTextbooks().then(list => {
      const wrap = h("div", { class: "ed-modal" }, [
        h("div", { class: "ed-modal-box" }, [
          h("h3", null, "Add exercises to which textbook?"),
          list.length ? h("div", { class: "ed-modal-list" }, list.map(tb =>
            h("button", { class: "sr-item", type: "button", onclick: () => { closeModal(); location.hash = "#/edit/book/" + encodeURIComponent(tb.folder || tb.id) + "/student"; } }, [
              h("span", { class: "sr-icon" }, tb.icon || "📕"),
              h("span", null, [h("span", { class: "sr-title" }, tb.title),
                                h("span", { class: "sr-sub" }, (tb.level || "") + " · " + (tb.books || []).map(b => b.slot).join(", "))]),
            ]))) : h("p", { class: "ed-help" }, "No textbooks found."),
          btn("Cancel", "btn-ghost", closeModal),
        ]),
      ]);
      openModal(wrap);
    }).catch(e => toast(String(e.message || e), "bad"));
  }
  /* ============================================================ #/import */
  function renderImport() {
    renderCrumbs([{ label: "🏠 Textbooks", href: "#/" }, { label: "📥 Import pack" }]);
    app.innerHTML = `
      <section>
        <h2 class="step-title"><span class="stepnum">↓</span> Import an exercise pack</h2>
        <p class="instr" style="color:var(--muted)">Choose a <code>*.iebpack.json</code> file received from another
        teacher (email, USB stick, chat — anything). It contains the whole course including images and audio.</p>
        <div class="ed-drop" id="dropZone">
          <div style="font-size:40px">📦</div>
          <div><strong>Drop the pack here</strong> or click to choose a file</div>
          <input type="file" id="packFile" accept=".json,application/json" style="display:none">
        </div>
        <div id="importInfo"></div>
      </section>`;
    const zone = document.getElementById("dropZone");
    const fi = document.getElementById("packFile");
    zone.onclick = () => fi.click();
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("over"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault(); zone.classList.remove("over");
      if (e.dataTransfer.files[0]) handlePackFile(e.dataTransfer.files[0]);
    });
    fi.onchange = () => fi.files[0] && handlePackFile(fi.files[0]);
  }

  function handlePackFile(file) {
    const info = document.getElementById("importInfo");
    const reader = new FileReader();
    reader.onload = async () => {
      let json;
      try { json = JSON.parse(String(reader.result)); }
      catch (e) { info.innerHTML = `<div class="error-box">This file is not valid JSON.</div>`; return; }
      const chk = S.readPack(json);
      if (!chk.ok) {
        info.innerHTML = `<div class="error-box">${esc(chk.errors.join("<br>"))}</div>`;
        return;
      }
      const m = chk.manifest;
      const nTasks = Object.values(chk.books).reduce((s, b) => s + b.units.reduce((x, u) => x + u.lessons.reduce((y, l) => y + l.tasks.length, 0), 0), 0);
      info.innerHTML = "";
      const box = h("div", { class: "hint-card" }, [
        h("div", null, [h("strong", null, (m.icon || "📦") + " " + m.title),
          h("span", { class: "badge level", style: "margin-left:8px" }, m.level || "course")]),
        h("div", { style: "margin-top:6px;color:var(--muted)" },
          `${nTasks} task(s) · ${Object.keys(chk.books).length} book(s) · ${Object.keys(chk.assets).length} media file(s)`),
      ]);
      info.appendChild(box);
      const actions = h("div", { style: "display:flex;gap:12px;margin-top:14px;flex-wrap:wrap" }, [
        btn("✔ Install into textbooks/", "btn-primary", async () => {
          if (FILE_MODE) {
            download(file.name.replace(/\.json$/i, "") + ".iebpack.json", JSON.stringify(json));
            toast("Saved locally. Put the file into textbooks/ and refresh.", "ok");
            return;
          }
          try {
            const res = await api("POST", "/api/import", { pack: json });
            toast("Installed as “" + res.title + "”", "ok");
            invalidateCaches();
            location.hash = "#/tb/" + encodeURIComponent(res.folder);
          } catch (e) { toast("Import failed: " + e.message, "bad"); }
        }),
        btn("Preview & edit first", "btn-ghost", () => {
          startSession({
            target: { mode: "standalone" },
            manifest: json.manifest,
            slot: Object.keys(chk.books)[0] || "student",
            book: chk.books[Object.keys(chk.books)[0] || "student"],
            assets: json.assets || {},
          });
        }),
      ]);
      info.appendChild(actions);
    };
    reader.readAsText(file);
  }

  /* ============================================================ EDITOR SESSION
     One editing session = the book being edited + where it should be saved.  */
  let session = null;
  let autosaveTimer = null;

  function invalidateCaches() {
    Object.keys(bookCache).forEach(k => delete bookCache[k]);
    Object.keys(taskCache).forEach(k => delete taskCache[k]);
  }

  function blankTask(type) {
    return (S && S.blankTask) ? S.blankTask(type) : { type, title: "", instruction: "" };
  }

  /* Start (or resume) a session. opts: {mode:'new'} | loaded draft | existing book */
  async function startSession(payload, draftName) {
    session = {
      draftName: draftName || null,
      target: payload.target || { mode: "standalone" },
      manifest: payload.manifest,
      slot: payload.slot || "student",
      book: payload.book,
      assets: payload.assets || {},     // rel -> dataURL (pending uploads)
      dirty: false,
    };
    if (!session.draftName) {
      session.draftName = "draft-" + S.slugify(session.manifest.title || "course") + "-" + Date.now().toString(36).slice(-4);
    }
    autosave();
    renderEditorOutline();
  }

  function markDirty() {
    if (!session) return;
    session.dirty = true;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(autosave, 1500);
    const st = document.getElementById("edSaveState");
    if (st) st.textContent = "● unsaved changes";
  }

  function sessionStats() {
    const vb = S.validateBook(session.book);
    return vb;
  }

  function autosave() {
    if (!session) return;
    const vb = sessionStats();
    const payload = {
      updated: new Date().toISOString(),
      target: session.target,
      manifest: session.manifest,
      slot: session.slot,
      book: session.book,
      assets: session.assets,
      stats: vb.stats,
    };
    lsSetDraft(session.draftName, payload);
    if (!FILE_MODE) {
      api("POST", "/api/drafts/" + encodeURIComponent(session.draftName), payload)
        .then(() => { const st = document.getElementById("edSaveState"); if (st) st.textContent = "✓ autosaved"; })
        .catch(() => { const st = document.getElementById("edSaveState"); if (st) st.textContent = "✓ autosaved (local)"; });
    } else {
      const st = document.getElementById("edSaveState");
      if (st) st.textContent = "✓ autosaved (local)";
    }
    session.dirty = false;
  }

  /* ---------------------------------------------------- build final payload */
  function buildSavePayload() {
    const vb = sessionStats();
    if (!vb.ok) return { errors: vb.errors };
    return {
      payload: {
        manifest: session.manifest,
        books: { [session.slot]: vb.value },
        assets: session.assets,
      },
      warnings: vb.warnings,
      stats: vb.stats,
    };
  }

  /* Merge freshly created content into an existing textbook tree. */
  async function mergeIntoExisting(target, newBook) {
    const base = await loadBookRaw(target.tbId, target.slot);
    const clone = JSON.parse(JSON.stringify(base));
    const encIds = (obj, prefix) => { obj.id = prefix + obj.id; };
    if (target.kind === "book") {
      clone.units = clone.units.concat(newBook.units);
    } else {
      let unit = clone.units.find(u => u.id === target.unitId);
      if (!unit) { clone.units.push(newBook.units[0]); }
      else if (target.kind === "unit") {
        unit.lessons = unit.lessons.concat(newBook.units[0].lessons);
      } else {
        const lesson = unit.lessons.find(l => l.id === target.lessonId);
        if (!lesson) throw new Error("Lesson disappeared — reload and try again");
        lesson.tasks = lesson.tasks.concat(newBook.units[0].lessons[0].tasks);
      }
    }
    return { manifestOnly: true, books: { [target.slot]: clone } };
  }

  /* ---------------------------------------------------- SAVE */
  async function saveSession(asNewCourse) {
    if (!session) return;
    const built = buildSavePayload();
    if (built.errors) {
      toast("Please fix " + built.errors.length + " problem(s) first", "bad");
      showValidation(built.errors, built.errorsWarnings || []);
      return;
    }
    const target = session.target;
    const wantMerge = target.mode === "existing" && !asNewCourse;

    if (FILE_MODE) {
      // no backend: hand the teacher ready-made files
      if (wantMerge) { toast("Merging into an installed book needs the local server (start.bat / desktop app). Saving a standalone copy instead.", "bad"); }
      const fname = S.slugify(session.manifest.title || "my-course");
      download(fname + "." + session.slot + ".json", JSON.stringify(built.payload.books[session.slot], null, 2));
      download(fname + ".manifest.json", JSON.stringify(Object.assign({}, session.manifest, { [session.slot]: session.manifest[slotLabel(session.slot)] || "My course" }), null, 2));
      exportPack();
      toast("Files downloaded — put them into textbooks/" + fname + "/", "ok");
      return;
    }

    let body;
    if (wantMerge) {
      try {
        body = await mergeIntoExisting(target, built.payload.books[session.slot]);
        body.assets = built.payload.assets;
      } catch (e) { toast(e.message, "bad"); return; }
      try {
        const res = await api("PATCH", "/api/textbooks/" + encodeURIComponent(target.tbId), body);
        afterSave(res, target.tbTitle || res.title, built.warnings);
      } catch (e) { toast("Could not save: " + e.message, "bad"); }
    } else {
      try {
        const res = await api("POST", "/api/textbooks", built.payload);
        afterSave(res, res.title, built.warnings);
      } catch (e) { toast("Could not save: " + e.message, "bad"); }
    }
  }

  function afterSave(res, title, warnings) {
    invalidateCaches();
    if (session) { session.savedTo = res.folder; session.target = { mode: "saved", tbId: res.folder, tbTitle: title }; }
    lsDelDraft(session.draftName);
    toast("Saved ✔ “" + title + "” is in your textbook list", "ok");
    if (warnings && warnings.length) toast(warnings.length + " warning(s): " + warnings[0], "warn");
    location.hash = "#/tb/" + encodeURIComponent(res.folder);
  }

  function slotLabel(slot) { return slot === "workbook" ? "Workbook" : "Student's Book"; }

  /* ---------------------------------------------------- PUBLISH to shared-exercises/
     One click puts the course into its own folder shared-exercises/<course>/
     AND writes <course>.iebpack.json next to it — a single file that can be
     sent to anyone (chat / e-mail / USB). They import it and the course shows
     up in their library with the author's name. */
  async function publishCourse() {
    if (!session) return;
    const built = buildSavePayload();
    if (built.errors) {
      toast("Please fix " + built.errors.length + " problem(s) first", "bad");
      showValidation(built.errors, []);
      return;
    }
    const manifest = Object.assign({}, session.manifest);
    manifest[session.slot] = manifest[session.slot] || slotLabel(session.slot);
    if (session.inplace) {
      // editing an installed book → publishing makes a standalone shared copy
      manifest.id = S.slugify(manifest.title || "course") + "-shared";
    }
    if (FILE_MODE) {
      downloadPackFor(null, null, { manifest, books: built.payload.books, assets: session.assets });
      toast("Server is not running — downloaded the pack file instead. Start server.py to publish into shared-exercises/.", "warn");
      return;
    }
    try {
      const res = await api("POST", "/api/publish", { manifest, books: built.payload.books, assets: session.assets });
      invalidateCaches();
      if (session) { session.publishedTo = res.folder; lsDelDraft(session.draftName); }
      openModal(modal("📦 Published!", [
        h("p", null, ["Course ", h("strong", null, "“" + res.title + "”"), " is now in your library and saved as a shareable package:"]),
        h("div", { class: "ed-path" }, "shared-exercises/" + res.folder + "/"),
        h("p", { class: "ed-help" }, "The whole folder can be copied to a colleague as-is, but the easiest way is the single pack file:"),
        h("div", { class: "ed-path" }, "shared-exercises/" + res.pack_name),
        h("p", { class: "ed-help" }, "Send that one file by chat / e-mail / flash drive — your colleague opens it via “Import pack”."),
      ], [
        btn("⬇ Download pack file", "btn-primary", () => { location.href = API(res.pack_url); }),
        btn("Open course", "btn-ghost", () => { closeModal(); location.hash = "#/tb/" + encodeURIComponent(res.folder); }),
        btn("Close", "btn-ghost", closeModal),
      ]));
    } catch (e) { toast("Publish failed: " + e.message, "bad"); }
  }

  /* download (or build locally) the .iebpack.json for a published course */
  async function downloadPackFor(tbId, title, inlinePack) {
    let packObj = inlinePack || null;
    if (!packObj && tbId) {
      const res = await fetch(API("/api/textbooks/" + encodeURIComponent(tbId) + "/export"));
      if (!res.ok) throw new Error("HTTP " + res.status);
      packObj = await res.json();
    }
    if (!packObj) throw new Error("nothing to export");
    const name = S.slugify((packObj.manifest && packObj.manifest.title) || title || "course");
    download(name + ".iebpack.json", JSON.stringify(packObj));
  }

  /* ---------------------------------------------------- EXPORT PACK */
  async function exportPack() {
    if (!session) return;
    const built = buildSavePayload();
    if (built.errors) { toast("Fix validation problems before exporting", "bad"); showValidation(built.errors); return; }
    const manifest = Object.assign({}, session.manifest);
    manifest[session.slot] = manifest[session.slot] || slotLabel(session.slot);
    const pack = S.buildPack({ manifest, books: built.payload.books, assets: session.assets });
    const name = S.slugify(manifest.title || "course");
    if (FILE_MODE) {
      download(name + ".iebpack.json", JSON.stringify(pack));
      toast("Pack downloaded — send the file to colleagues", "ok");
      return;
    }
    try {
      const res = await fetch(API("/api/textbooks/" + encodeURIComponent(session.savedTo || "") + "/export"));
      if (res.ok) {
        const data = await res.json();
        download(name + ".iebpack.json", JSON.stringify(data));
        toast("Pack downloaded (with all media)", "ok");
        return;
      }
    } catch (e) { /* not saved yet — fall back to the browser-side pack */ }
    download(name + ".iebpack.json", JSON.stringify(pack));
    toast("Pack downloaded — send the file to colleagues", "ok");
  }

  /* ---------------------------------------------------- SHARE LINK */
  async function shareLink() {
    if (!session) return;
    const built = buildSavePayload();
    if (built.errors) { toast("Fix validation problems before sharing", "bad"); return; }
    const manifest = Object.assign({}, session.manifest);
    manifest[session.slot] = manifest[session.slot] || slotLabel(session.slot);
    const pack = S.buildPack({ manifest, books: built.payload.books, assets: session.assets });
    const text = JSON.stringify(pack);
    try {
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = S.slugify(manifest.title) + ".iebpack.json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { /* ignore */ }
    const encoded = btoa(unescape(encodeURIComponent(text)));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText("IntExeBook pack (base64):\n" + encoded.slice(0, 4000));
        toast("Pack downloaded. Base64 preview copied — or just send the file.", "ok");
      } catch (e) { toast("Pack downloaded — send that file to your colleagues", "ok"); }
    } else {
      toast("Pack downloaded — send that file to your colleagues", "ok");
    }
  }

  /* ---------------------------------------------------- validation panel */
  function showValidation(errors, warnings) {
    let p = document.getElementById("edProblems");
    if (!p) {
      p = h("div", { id: "edProblems", class: "ed-problems" });
      document.querySelector(".ed-layout").appendChild(p);
    }
    p.innerHTML = "";
    p.appendChild(h("h4", null, "⚠ Problems to fix (" + errors.length + ")"));
    errors.slice(0, 20).forEach(e => p.appendChild(h("div", { class: "ed-prob-line bad" }, e)));
    (warnings || []).slice(0, 10).forEach(w => p.appendChild(h("div", { class: "ed-prob-line warn" }, w)));
    p.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* ============================================================ entry: route #/edit* */
  async function renderEditor(params) {
    if (!params || params.mode === "new") {
      const d = S.starterDraft();
      return startSession(d);
    }
    // editing an existing textbook: load the full raw book into a session
    const { tbId, slot, unitId, lessonId, taskId } = params;
    try {
      const tb = await loadBookMeta(tbId);
      const useSlot = slot || "student";
      const book = await loadBookRaw(tbId, useSlot);
      delete book.book_label; delete book.textbook_title;
      const manifest = Object.assign({}, tb, { id: tb.folder || tb.id });
      ["books", "folder", "error"].forEach(k => delete manifest[k]);
      session = {
        draftName: "edit-" + S.slugify(tbId) + "-" + useSlot,
        target: { mode: "inplace", tbId: tb.folder || tb.id, tbTitle: tb.title, slot: useSlot },
        manifest: manifest,
        slot: useSlot,
        book: book,
        assets: {},
        dirty: false,
        inplace: true,
      };
      renderEditorOutline({ focusUnit: unitId, focusLesson: lessonId, focusTask: taskId });
    } catch (e) {
      app.innerHTML = `<div class="error-box">Could not open this textbook for editing: ${esc(e.message || e)} <a href="#/create" style="color:inherit;text-decoration:underline">← back to Create</a></div>`;
    }
  }

  /* ============================================================ OUTLINE VIEW */
  function renderEditorOutline(focus) {
    if (!session) { location.hash = "#/create"; return; }
    const t = targetSummary(session.target);
    renderCrumbs([{ label: "🏠 Textbooks", href: "#/" }, { label: "🛠 Create", href: "#/create" }, { label: session.manifest.title || "Untitled course" }]);
    app.innerHTML = "";

    const bar = h("div", { class: "ed-bar" }, [
      h("div", { class: "ed-bar-left" }, [
        h("strong", null, "🛠 " + (session.manifest.title || "Untitled course")),
        h("span", { class: "ed-target-chip" }, t.icon + " " + t.title + " — " + t.sub),
      ]),
      h("div", { class: "ed-bar-right" }, [
        h("span", { id: "edSaveState", class: "ed-state" }, "✓ autosaved"),
        btn("Course settings", "btn-ghost", editSettings),
        btn("Share / export", "btn-ghost", exportDialog),
        btn(session.inplace ? "💾 Save" : "💾 Save draft", "btn-ghost", () => saveSession(false)),
        btn("📦 Publish & share", "btn-primary", publishCourse),
      ]),
    ]);

    const layout = h("div", { class: "ed-layout" });
    const main = h("div", { class: "ed-main" });
    layout.appendChild(main);
    app.appendChild(bar);
    app.appendChild(layout);

    if (session.inplace) {
      main.appendChild(h("div", { class: "hint-card" }, [
        h("strong", null, "You are editing the installed textbook directly."),
        " Changes are written back into its folder when you press Save. To keep a separate copy, use ",
        h("b", null, "Course settings → detach as a new course"), ".",
      ]));
    }

    const vb = sessionStats();
    main.appendChild(h("div", { class: "ed-stats" }, [
      chip("📚 " + vb.stats.units + " unit(s)"), chip("📖 " + vb.stats.lessons + " lesson(s)"),
      chip("⭐ " + vb.stats.tasks + " task(s)"),
      vb.errors.length ? chip("⚠ " + vb.errors.length + " problem(s)", "bad") : chip("✓ valid", "ok"),
    ]));

    const actions = h("div", { class: "ed-actions" }, [
      rowBtn("＋ Add unit / topic", () => addUnit()),
      rowBtn("＋ Quick add task…", () => quickAddTask()),
    ]);
    main.appendChild(actions);

    session.book.units.forEach((u, ui) => main.appendChild(unitCard(u, ui, focus)));

    const saveRow = h("div", { class: "check-row" }, [
      btn("← Back to textbooks", "btn-ghost", () => { location.hash = "#/"; }),
      h("div", { style: "display:flex;gap:10px" }, [
        btn("Share / export", "btn-ghost", exportDialog),
        btn(session.inplace ? "💾 Save changes" : "💾 Save draft", "btn-ghost", () => saveSession(false)),
        btn("📦 Publish & share", "btn-primary", publishCourse),
      ]),
    ]);
    main.appendChild(saveRow);
  }

  function chip(text, cls) { return h("span", { class: "ed-chip" + (cls ? " " + cls : "") }, text); }

  function unitCard(u, ui, focus) {
    const card = h("div", { class: "ed-card" + (focus && focus.focusUnit === u.id ? " ed-focus" : "") });
    const head = h("div", { class: "ed-card-head" }, [
      input(u.title, (v) => { u.title = v; markDirty(); }, { placeholder: "Unit / topic title" }),
      rowBtn("↑", () => moveItem(session.book.units, ui, -1), "tiny"),
      rowBtn("↓", () => moveItem(session.book.units, ui, 1), "tiny"),
      rowBtn("Rename id", () => { const n = prompt("Unit id", u.id); if (n) { u.id = S.slugify(n); markDirty(); renderEditorOutline(focus); } }, "tiny"),
      rowBtn("🗑", () => { if (confirm("Delete unit \u201c" + (u.title || u.id) + "\u201d?")) { session.book.units.splice(ui, 1); markDirty(); renderEditorOutline(focus); } }, "danger tiny"),
    ]);
    card.appendChild(head);
    (u.lessons || []).forEach((l, li) => card.appendChild(lessonRow(u, ui, l, li, focus)));
    card.appendChild(h("div", { class: "ed-card-foot" }, [
      rowBtn("＋ Add lesson / topic", () => {
        (u.lessons = u.lessons || []).push({ id: S.makeId("l", "lesson-" + (u.lessons.length + 1), idSet(u.lessons)), title: "New topic " + (u.lessons.length + 1), tasks: [] });
        markDirty(); renderEditorOutline(focus);
      }),
    ]));
    return card;
  }

  function lessonRow(u, ui, l, li, focus) {
    const row = h("div", { class: "ed-lesson" + (focus && focus.focusLesson === l.id ? " ed-focus" : "") });
    row.appendChild(input(l.title, (v) => { l.title = v; markDirty(); }, { placeholder: "Lesson / topic title", class: "ed-input ed-lesson-title-in" }));
    row.appendChild(input(l.page == null ? "" : l.page, (v) => { l.page = v ? parseInt(v, 10) || null : null; markDirty(); }, { placeholder: "page", type: "number", class: "ed-input ed-page-num" }));
    const pills = h("div", { class: "ed-tasks" });
    (l.tasks || []).forEach((t, ti) => {
      const pill = h("span", { class: "ed-task-pill" + (focus && focus.focusTask === t.id ? " active" : "") }, [
        h("span", null, (S.TASK_TYPES.find(x => x.type === t.type) || {}).icon || "⭐"),
        h("span", { class: "ed-task-name" }, t.title || "Untitled"),
        h("button", { class: "ed-mini", type: "button", onclick: () => openTaskEditor(u, ui, l, li, t, ti) }, "✎"),
        h("button", { class: "ed-mini danger", type: "button", onclick: () => {
          if (confirm("Delete task “" + (t.title || t.id) + "”?")) { l.tasks.splice(ti, 1); markDirty(); renderEditorOutline(focus); }
        } }, "✕"),
      ]);
      pill.title = t.type;
      pills.appendChild(pill);
    });
    row.appendChild(pills);
    row.appendChild(h("div", { class: "ed-row-actions" }, [
      rowBtn("＋ Task", () => {
        const t = Object.assign({ id: S.makeId("t", "task-" + ((l.tasks || []).length + 1), idSet(l.tasks)) }, blankTask("multiple-choice"));
        (l.tasks = l.tasks || []).push(t);
        markDirty(); renderEditorOutline(focus);
        openTaskEditor(u, ui, l, li, t, l.tasks.length - 1);
      }),
      rowBtn("Duplicate", () => {
        const copy = JSON.parse(JSON.stringify(l));
        copy.id = S.makeId("l", copy.title || "lesson", idSet(u.lessons));
        copy.tasks = (copy.tasks || []).map(t => Object.assign({}, t, { id: S.makeId("t", t.title || "task", idSet(copy.tasks)) }));
        u.lessons.splice(li + 1, 0, copy); markDirty(); renderEditorOutline(focus);
      }),
      rowBtn("Move ↑", () => moveItem(u.lessons, li, -1), "tiny"),
      rowBtn("Move ↓", () => moveItem(u.lessons, li, 1), "tiny"),
      rowBtn("🗑", () => { if (confirm("Delete lesson “" + (l.title || l.id) + "”?")) { u.lessons.splice(li, 1); markDirty(); renderEditorOutline(focus); } }, "danger tiny"),
    ]));
    return row;
  }

  function idSet(arr) { const s = new Set(); (arr || []).forEach(x => s.add(x.id)); return s; }

  function moveItem(arr, i, dir) {
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    markDirty(); renderEditorOutline();
  }

  function addUnit() {
    const taken = idSet(session.book.units);
    const u = { id: S.makeId("u", "unit-" + (session.book.units.length + 1), taken), title: "New unit / topic", lessons: [] };
    session.book.units.push(u);
    markDirty(); renderEditorOutline({ focusUnit: u.id });
  }

  function quickAddTask() {
    if (!session.book.units.length) addUnit();
    const u = session.book.units[session.book.units.length - 1];
    if (!u.lessons || !u.lessons.length) { u.lessons = [{ id: S.makeId("l", "lesson", idSet(u.lessons)), title: "New lesson", tasks: [] }]; }
    const l = u.lessons[u.lessons.length - 1];
    const t = Object.assign({ id: S.makeId("t", "task-" + (l.tasks.length + 1), idSet(l.tasks)) }, blankTask("multiple-choice"));
    (l.tasks = l.tasks || []).push(t);
    markDirty();
    openTaskEditor(u, session.book.units.indexOf(u), l, u.lessons.indexOf(l), t, l.tasks.length - 1);
  }

  /* ---------------------------------------------------- course settings */
  function editSettings() {
    const m = session.manifest;
    const box = modal("Course settings", [
      field("Title", input(m.title, v => { m.title = v; markDirty(); })),
      field("Subtitle", input(m.subtitle || "", v => { m.subtitle = v; markDirty(); })),
      field("Level", input(m.level || "", v => { m.level = v; markDirty(); })),
      field("Description", textarea(m.description || "", v => { m.description = v; markDirty(); }, 2)),
      h("div", { class: "ed-inline" }, [
        field("Icon", input(m.icon || "📕", v => { m.icon = v; markDirty(); }, { class: "ed-input ed-icon-in" })),
        field("Colour", h("input", { type: "color", class: "ed-color", value: m.color || "#6366f1", oninput: (e) => { m.color = e.target.value; markDirty(); } })),
      ]),
      session.inplace ? h("div", { class: "hint-card" }, [
        "This session edits the installed book “", esc(session.target.tbTitle || session.target.tbId), "”. ",
        h("button", { class: "ed-mini", type: "button", onclick: () => {
          session.inplace = false;
          session.target = { mode: "standalone" };
          session.manifest = Object.assign({}, session.manifest, { id: "", title: (session.manifest.title || "Course") + " (copy)" });
          closeModal(); markDirty(); renderEditorOutline();
        } }, "Detach as a new course"),
      ]) : targetPicker(),
    ], [btn("Done", "btn-primary", closeModal)]);
    openModal(box);
  }

  function targetPicker() {
    const wrap = h("div", { class: "ed-target-picker" });
    function paint() {
      wrap.innerHTML = "";
      const radios = [
        ["standalone", "Standalone course (its own book in the list)"],
        ["attach", "Attach to an existing textbook …"],
      ];
      radios.forEach(([mode, label]) => {
        const r = h("label", { class: "ed-radio" }, [
          h("input", { type: "radio", name: "edtarget", checked: (session.target.mode === "standalone") === (mode === "standalone"), onchange: () => {
            session.target = mode === "standalone" ? { mode: "standalone" } : { mode: "existing", kind: "book" };
            paint(); markDirty();
          } }),
          label,
        ]);
        wrap.appendChild(r);
      });
      if (session.target.mode !== "standalone") {
        const t = session.target;
        const books = FILE_MODE ? [] : null;
        const sel = select(t.tbId || "", [["", "— choose textbook —"]], async (v) => { t.tbId = v; paint(); });
        loadAllTextbooks().then(list => {
          sel.innerHTML = "";
          sel.appendChild(h("option", { value: "" }, "— choose textbook —"));
          list.forEach(tb => {
            const o = h("option", { value: tb.folder || tb.id }, tb.title);
            if ((tb.folder || tb.id) === t.tbId) o.selected = true;
            sel.appendChild(o);
          });
        });
        wrap.appendChild(field("Textbook", sel));

        const kindSel = select(t.kind || "book", [["book", "add as new units in the book"], ["unit", "inside one unit (as new lessons)"], ["lesson", "inside one lesson (as new tasks)"]], (v) => { t.kind = v; paint(); });
        wrap.appendChild(field("Where", kindSel));

        if (t.kind !== "book" && t.tbId) {
          loadRawBookOptions(t).then(opts => {
            const usel = select(t.unitId || "", opts.units, (v) => { t.unitId = v; paint(); });
            wrap.appendChild(field("Unit", usel));
            if (t.kind === "lesson") {
              const lsel = select(t.lessonId || "", opts.lessons || [], (v) => { t.lessonId = v; markDirty(); });
              wrap.appendChild(field("Lesson", lsel));
            }
          });
        }
      }
    }
    paint();
    return wrap;
  }

  async function loadAllTextbooks() {
    const data = FILE_MODE ? await A.loadFileModeIndex() : await getJSON("/api/textbooks");
    return (data.textbooks || []).filter(t => !t.error);
  }

  async function loadRawBookOptions(t) {
    const out = { units: [], lessons: [] };
    try {
      const book = await loadBookRaw(t.tbId, t.slot || "student");
      out.units = (book.units || []).map(u => [u.id, u.title]);
      const unit = (book.units || []).find(u => u.id === t.unitId);
      out.lessons = ((unit && unit.lessons) || []).map(l => [l.id, l.title]);
    } catch (e) { /* book may lack this slot */ }
    return out;
  }

  /* ---------------------------------------------------- modal helpers */
  let modalEl = null;
  function modal(title, children, footer) {
    return h("div", { class: "ed-modal", onclick: (e) => { if (e.target === modalEl) closeModal(); } }, [
      h("div", { class: "ed-modal-box" }, [
        h("h3", null, title),
        h("div", { class: "ed-modal-body" }, children),
        footer ? h("div", { class: "ed-modal-foot" }, footer) : null,
      ]),
    ]);
  }
  function openModal(box) { closeModal(); modalEl = box; document.body.appendChild(box); }
  function closeModal() { if (modalEl) { modalEl.remove(); modalEl = null; } }
  function field(label, el) { return h("label", { class: "ed-field" }, [h("span", null, label), el]); }

  /* ---------------------------------------------------- export dialog */
  function exportDialog() {
    const built = buildSavePayload();
    const lines = [];
    lines.push(h("p", { class: "ed-help" },
      "A pack is a single JSON file with all units, lessons, tasks and media. Send it to colleagues however you like — they import it via “Import pack”."));
    if (built.errors) lines.push(h("div", { class: "error-box" }, "Fix " + built.errors.length + " problem(s) before exporting."));
    if (session.inplace) lines.push(h("div", { class: "hint-card" }, "Tip: this course is currently attached to the installed book “" + esc((session.target && session.target.tbTitle) || "") + "”. Exporting creates a standalone copy."));
    openModal(modal("Share this course", lines, [
      btn("📦 Publish & share", "btn-primary", publishCourse),
      btn("📤 Download .iebpack.json", "btn-ghost", exportPack),
      btn("Close", "btn-ghost", closeModal),
    ]));
  }

  /* ============================================================ TASK EDITOR */
  function openTaskEditor(u, ui, l, li, t, ti) {
    const repainted = () => { markDirty(); closeModal(); renderEditorOutline({ focusUnit: u.id, focusLesson: l.id, focusTask: t.id }); };
    const tabs = h("div", { class: "ed-tabs" });
    const pane = h("div", { class: "ed-pane" });
    const mediaPane = h("div", { class: "ed-pane ed-media-pane" });

    function renderTabs(active) {
      tabs.innerHTML = "";
      [["content", "✍ Content"], ["preview", "👁 Preview"], ["media", "🖼 Media"]].forEach(([id, label]) => {
        tabs.appendChild(h("button", { class: "ed-tab" + (id === active ? " active" : ""), type: "button", onclick: () => renderTabs(id) }, label));
      });
      if (active === "preview") pane.innerHTML = "", pane.appendChild(previewBlock(t));
      else if (active === "media") pane.innerHTML = "", pane.appendChild(mediaEditor(t));
      else pane.innerHTML = "", pane.appendChild(contentForm());
    }

    function contentForm() {
      const f = h("div", null);
      f.appendChild(field("Type", select(t.type, S.TASK_TYPES.map(x => [x.type, x.icon + " " + x.label]), (v) => {
        const keep = { id: t.id, title: t.title, instruction: t.instruction, media: t.media, explanation: t.explanation };
        Object.assign(t, keep, blankTask(v));
        renderTabs("content"); repaintAll();
      })));
      f.appendChild(field("Task title", input(t.title, v => { t.title = v; markDirty(); }, { placeholder: "e.g. Past simple — choose the correct form" })));
      f.appendChild(field("Instruction shown to students", textarea(t.instruction, v => { t.instruction = v; markDirty(); }, 2)));
      f.appendChild(typeFields(t, () => renderTabs("preview")));
      f.appendChild(field("Explanation (shown after answering)", input(t.explanation || "", v => { t.explanation = v || undefined; markDirty(); })));
      return f;
    }

    function repaintAll() { /* live: nothing extra needed, autosave handles it */ }

    const box = h("div", { class: "ed-modal ed-modal-wide" }, [
      h("div", { class: "ed-modal-box ed-modal-box-wide" }, [
        h("h3", null, (S.TASK_TYPES.find(x => x.type === t.type) || {}).icon + "  Edit task"),
        h("div", { class: "ed-crumbline" }, [u.title || u.id, " › ", l.title || l.id].map(x => typeof x === "string" ? document.createTextNode(x) : x)),
        tabs, pane,
        h("div", { class: "ed-modal-foot" }, [
          btn("Done", "btn-primary", repainted),
          btn("Duplicate", "btn-ghost", () => {
            const copy = JSON.parse(JSON.stringify(t));
            copy.id = S.makeId("t", copy.title || "task", idSet(l.tasks));
            l.tasks.splice(ti + 1, 0, copy);
            repainted();
          }),
          btn("Delete", "btn-ghost", () => {
            if (confirm("Delete this task?")) { l.tasks.splice(ti, 1); markDirty(); closeModal(); renderEditorOutline(); }
          }),
        ]),
      ]),
    ]);
    box.addEventListener("click", (e) => { if (e.target === box) closeModal(); });
    openModal(box);
    renderTabs("content");
    modalEl = box;
  }

  /* ---- per-type forms ---- */
  function typeFields(t, onSwitch) {
    const wrap = h("div", { class: "ed-typeform" });
    if (t.type === "multiple-choice") {
      t.options = t.options || ["", ""];
      const list = h("div", { class: "ed-optlist" });
      const redraw = () => {
        list.innerHTML = "";
        t.options.forEach((o, i) => {
          const radio = h("input", { type: "radio", name: "mcans", checked: t.answerIndex === i, onchange: () => { t.answerIndex = i; markDirty(); } });
          list.appendChild(h("div", { class: "ed-optrow" }, [
            radio,
            input(o, v => { t.options[i] = v; markDirty(); }, { placeholder: "Option " + (i + 1) }),
            rowBtn("✕", () => { t.options.splice(i, 1); if (t.answerIndex >= t.options.length) t.answerIndex = 0; redraw(); markDirty(); }, "danger tiny"),
          ]));
        });
        list.appendChild(h("div", { class: "ed-row-actions" }, [
          rowBtn("＋ Option", () => { t.options.push(""); redraw(); markDirty(); }),
          h("span", { class: "ed-help" }, "Select the radio button next to the correct answer."),
        ]));
      };
      redraw();
      wrap.appendChild(list);
    } else if (t.type === "true-false") {
      wrap.appendChild(field("Statement / question", textarea(t.instruction, v => { t.instruction = v; markDirty(); }, 2)));
      wrap.appendChild(h("div", { class: "ed-inline" }, [
        h("label", { class: "ed-radio" }, [h("input", { type: "radio", name: "tfans", checked: t.answer === true, onchange: () => { t.answer = true; markDirty(); } }), "TRUE"]),
        h("label", { class: "ed-radio" }, [h("input", { type: "radio", name: "tfans", checked: t.answer === false, onchange: () => { t.answer = false; markDirty(); } }), "FALSE"]),
      ]));
    } else if (t.type === "gap-fill") {
      const gapsBox = h("div");
      const sync = () => {
        const n = (String(t.text || "").match(/_{2,}/g) || []).length;
        t.blanks = t.blanks || [];
        while (t.blanks.length < n) t.blanks.push({ answers: [""] });
        if (t.blanks.length > n) t.blanks.length = n;
        gapsBox.innerHTML = "";
        t.blanks.forEach((b, i) => {
          gapsBox.appendChild(h("div", { class: "ed-gaprow" }, [
            h("b", null, "Gap " + (i + 1)),
            input(Array.isArray(b.answers) ? b.answers.join(", ") : "", v => { b.answers = v.split(",").map(s => s.trim()).filter(Boolean); markDirty(); }, { placeholder: "accepted answers, comma separated" }),
            input(b.hint || "", v => { b.hint = v || undefined; markDirty(); }, { placeholder: "hint (optional)" }),
          ]));
        });
      };
      wrap.appendChild(field("Sentence — use ___ for each gap", textarea(t.text || "", v => { t.text = v; sync(); markDirty(); }, 3)));
      wrap.appendChild(gapsBox);
      sync();
    } else if (t.type === "word-order") {
      wrap.appendChild(field("Correct sentence (the answer)", input(t.answer || "", v => {
        t.answer = v;
        t.words = v.split(/\s+/).filter(Boolean);
        markDirty(); wordList();
      }, { placeholder: "She has never been to London" })));
      const wordList = () => {
        const wl = wrap.querySelector(".ed-wordlist");
        if (wl) wl.remove();
        wrap.appendChild(h("div", { class: "ed-wordlist ed-help" }, "Tiles: " + (t.words || []).length + " word(s) — generated from the answer above."));
      };
      wordList();
    } else if (t.type === "matching") {
      t.pairs = t.pairs && t.pairs.length ? t.pairs : [{ left: "", right: "" }, { left: "", right: "" }];
      const list = h("div");
      const redraw = () => {
        list.innerHTML = "";
        t.pairs.forEach((p, i) => {
          list.appendChild(h("div", { class: "ed-gaprow" }, [
            input(p.left, v => { p.left = v; markDirty(); }, { placeholder: "Left item" }),
            h("span", null, "↔"),
            input(p.right, v => { p.right = v; markDirty(); }, { placeholder: "Right item" }),
            rowBtn("✕", () => { t.pairs.splice(i, 1); redraw(); markDirty(); }, "danger tiny"),
          ]));
        });
        list.appendChild(rowBtn("＋ Pair", () => { t.pairs.push({ left: "", right: "" }); redraw(); markDirty(); }));
      };
      redraw();
      wrap.appendChild(list);
    } else if (t.type === "choose-odd-one-out") {
      t.options = (t.options || []).map(o => typeof o === "string" ? { text: o, isOdd: false } : { text: o.text || "", isOdd: !!o.isOdd });
      if (!t.options.length) t.options = [{ text: "", isOdd: false }, { text: "", isOdd: false }, { text: "", isOdd: true }];
      wrap.appendChild(field("Category hint (optional — shown to students)", input(t.categoryHint || "", v => { t.categoryHint = v || undefined; markDirty(); }, { placeholder: "e.g. fruits" })));
      wrap.appendChild(h("p", { class: "ed-help" }, "Tick “odd” next to every option that does NOT belong to the category."));
      const list = h("div");
      const redraw = () => {
        list.innerHTML = "";
        t.options.forEach((o, i) => {
          const cb = h("input", { type: "checkbox", checked: o.isOdd, onchange: () => { o.isOdd = cb.checked; markDirty(); } });
          list.appendChild(h("div", { class: "ed-optrow" }, [
            cb, h("span", { class: "ed-mini-label" }, "odd"),
            input(o.text, v => { o.text = v; markDirty(); }, { placeholder: "Option " + (i + 1) }),
            rowBtn("✕", () => { t.options.splice(i, 1); redraw(); markDirty(); }, "danger tiny"),
          ]));
        });
        list.appendChild(h("div", { class: "ed-row-actions" }, [
          rowBtn("＋ Option", () => { t.options.push({ text: "", isOdd: false }); redraw(); markDirty(); }),
        ]));
      };
      redraw();
      wrap.appendChild(list);
    } else if (t.type === "find-and-click") {
      wrap.appendChild(field("Sentence / short text", textarea(t.text || "", v => { t.text = v; markDirty(); }, 3)));
      wrap.appendChild(field("Words the student must click (comma separated)",
        input((t.targets || []).join(", "), v => { t.targets = v.split(",").map(s => s.trim()).filter(Boolean); markDirty(); },
          { placeholder: "cat, mat" })));
      wrap.appendChild(h("p", { class: "ed-help" }, "Tip: attach a picture via the Media tab and put the words in it into the instruction too."));
    } else if (t.type === "click-on-picture") {
      t.hotspots = t.hotspots || [];
      const imgRow = h("div", { class: "ed-inline" }, [
        (() => {
          const inp = h("input", { type: "file", accept: "image/*", class: "ed-file" });
          inp.onchange = () => {
            const f = inp.files[0];
            if (!f) return;
            if (f.size > MAX_ASSET) { toast("Image is larger than 12 MB — pick a smaller one.", "bad"); return; }
            const rd = new FileReader();
            rd.onload = () => {
              const rel = "assets/" + f.name.replace(/[^\w.\-]+/g, "_");
              if (session) session.assets[rel] = String(rd.result);
              t.image = rel;
              markDirty();
              renderTabs("preview");   // jump straight into the hotspot editor
              toast("Picture loaded — click on it to place hotspots, then name them in the Content tab.", "ok");
            };
            rd.readAsDataURL(f);
            inp.value = "";
          };
          return inp;
        })(),
        h("span", { class: "ed-help" }, t.image ? "current: " + t.image : "no picture yet"),
      ]);
      wrap.appendChild(field("Picture", imgRow));
      wrap.appendChild(h("p", { class: "ed-help" }, "After uploading, the Preview tab opens in “place hotspot” mode: every click on the picture adds a spot students must find. Name each spot below."));
      const hsList = h("div");
      const redrawHotspots = () => {
        hsList.innerHTML = "";
        t.hotspots.forEach((s, i) => {
          hsList.appendChild(h("div", { class: "ed-gaprow" }, [
            input(s.label, v => { s.label = v; markDirty(); }, { placeholder: "What to click (e.g. door)" }),
            h("span", { class: "ed-help" }, Math.round(s.x) + "% × " + Math.round(s.y) + "%"),
            rowBtn("✕", () => { t.hotspots.splice(i, 1); markDirty(); redrawHotspots(); }, "danger tiny"),
          ]));
        });
        hsList.appendChild(rowBtn("＋ Hotspot (center)", () => { t.hotspots.push({ label: "", x: 50, y: 50, r: 8 }); markDirty(); redrawHotspots(); }));
      };
      redrawHotspots();
      wrap.appendChild(hsList);
    } else if (t.type === "word-search") {
      t.words = t.words || [];
      t.grid = t.grid || [];
      wrap.appendChild(field("Words to hide (one per line, letters only)",
        textarea(t.words.join("\n"), v => {
          t.words = v.split("\n").map(s => s.toUpperCase().replace(/[^A-ZА-ЯЁ]/g, "")).filter(Boolean);
          markDirty();
        }, 5)));
      const sizeSel = select("12", [["9", "9×9"], ["12", "12×12"], ["15", "15×15"]], () => {});
      wrap.appendChild(h("div", { class: "ed-inline" }, [
        field("Grid size", sizeSel),
        rowBtn("⚙ Generate grid", () => {
          if (!S.generateWordGrid) return;
          const res = S.generateWordGrid(t.words, parseInt(sizeSel.value, 10) || 12);
          t.grid = res.rows;
          markDirty();
          toast(res.ok ? "Grid generated ✓" : "Some words didn't fit — try a bigger grid", res.ok ? "ok" : "bad");
          const old = wrap.querySelector(".ed-miniprev");
          if (old) old.remove();
          renderPreviewInto(wrap, t);
        }, "primary tiny"),
      ]));
      wrap.appendChild(h("p", { class: "ed-help" }, "Students click neighbouring letters to trace each word. Words run horizontally, vertically or diagonally."));
      renderPreviewInto(wrap, t);
    } else if (t.type === "translate-match") {
      t.pairs = t.pairs && t.pairs.length ? t.pairs : [{ left: "", right: "" }, { left: "", right: "" }];
      wrap.appendChild(h("p", { class: "ed-help" }, "Left column = English, right column = translation (or any two sets you want matched)."));
      const list = h("div");
      const redraw = () => {
        list.innerHTML = "";
        t.pairs.forEach((p, i) => {
          list.appendChild(h("div", { class: "ed-gaprow" }, [
            input(p.left, v => { p.left = v; markDirty(); }, { placeholder: "English word" }),
            h("span", null, "↔"),
            input(p.right, v => { p.right = v; markDirty(); }, { placeholder: "Translation" }),
            rowBtn("✕", () => { t.pairs.splice(i, 1); redraw(); markDirty(); }, "danger tiny"),
          ]));
        });
        list.appendChild(rowBtn("＋ Pair", () => { t.pairs.push({ left: "", right: "" }); redraw(); markDirty(); }));
      };
      redraw();
      wrap.appendChild(list);
    }
    return wrap;
  }

  /* mini live-preview embedded under some editors (word search grid etc.) */
  function renderPreviewInto(host, t) {
    const box = h("div", { class: "ed-miniprev" });
    host.appendChild(box);
    if (t.type !== "word-search" || !t.grid.length) return;
    const g = h("div", { class: "ws-grid ed-ws-static" });
    const cols = Math.max(...t.grid.map(r => String(r).length));
    g.style.gridTemplateColumns = `repeat(${cols}, minmax(0,1fr))`;
    t.grid.forEach(row => String(row).split("").forEach(ch => {
      const c = h("span", { class: "ws-cell static" }, ch);
      g.appendChild(c);
    }));
    box.appendChild(g);
  }

  /* ---- live preview using the real player engines ---- */
  function previewBlock(t) {
    const holder = h("div", { class: "ed-preview" });
    // show attached media first, so teachers see images/audio right in preview
    if (A.mediaHtml && session) {
      const tmp = document.createElement("div");
      tmp.innerHTML = A.mediaHtml(t, (session.savedTo || (session.target && session.target.tbId) || "") );
      const mediaEl = tmp.firstElementChild;
      if (mediaEl) holder.appendChild(mediaEl);
    }
    // hotspot placement mode for click-on-picture
    let placeHint = null;
    if (t.type === "click-on-picture") {
      placeHint = h("div", { class: "ed-place-hint" },
        "🎯 Placement mode: click anywhere on the picture to add a hotspot. Use ✕ next to a dot to remove it.");
      holder.appendChild(placeHint);
    }
    holder.appendChild(h("div", { class: "player" }, [
      h("div", { class: "badge" }, t.type),
      h("h2", { style: "margin:6px 0" }, t.title || "Untitled task"),
      h("p", { class: "instr" }, t.instruction || ""),
      (() => { const m = h("div", { id: "edPrevBody" }); return m; })(),
      (() => { const f = h("div", { class: "feedback" }); f.id = "edPrevFeedback"; return f; })(),
      (() => { const r = h("div", { class: "check-row" }); const b = h("button", { class: "btn btn-ghost", type: "button" }, "↺ Try again"); b.id = "edPrevRetry"; b.style.display = "none"; r.appendChild(b); return r; })(),
    ]));
    setTimeout(() => {
      const body = holder.querySelector("#edPrevBody");
      if (!body) return;
      try {
        window.renderTaskEngine(renderEngineCtx(body, t));
      } catch (e) {
        body.innerHTML = '<div class="ed-help">Preview unavailable: ' + esc(e.message) + "</div>";
      }
      if (t.type === "click-on-picture") enableHotspotPlacement(body, t, holder);
    }, 0);
    return holder;
  }

  /* In the editor's preview of click-on-picture the engine runs in play mode
     (hidden dots). We overlay authoring dots and turn clicks into placement. */
  function enableHotspotPlacement(body, t, holder) {
    const wrap = body.querySelector(".pic-wrap");
    if (!wrap) return;
    wrap.classList.add("ed-placing");
    let uid = 0;
    function drawAuthorDots() {
      wrap.querySelectorAll(".ed-hot").forEach(el => el.remove());
      (t.hotspots || []).forEach((s, i) => {
        const d = document.createElement("button");
        d.type = "button";
        d.className = "ed-hot";
        d.style.left = s.x + "%"; d.style.top = s.y + "%";
        d.textContent = String(i + 1);
        const kill = document.createElement("span");
        kill.className = "ed-hot-x"; kill.textContent = "✕";
        kill.onclick = (ev) => { ev.stopPropagation(); t.hotspots.splice(i, 1); markDirty(); drawAuthorDots(); };
        d.appendChild(kill);
        d.onclick = (ev) => ev.stopPropagation();
        wrap.appendChild(d);
      });
    }
    wrap.addEventListener("click", (e) => {
      if (e.target.closest(".ed-hot")) return;
      const rect = wrap.getBoundingClientRect();
      const x = Math.min(98, Math.max(2, ((e.clientX - rect.left) / rect.width) * 100));
      const y = Math.min(98, Math.max(2, ((e.clientY - rect.top) / rect.height) * 100));
      t.hotspots = t.hotspots || [];
      t.hotspots.push({ label: "Spot " + (t.hotspots.length + 1), x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, r: 8 });
      markDirty();
      drawAuthorDots();
      const hint = holder.querySelector(".ed-place-hint");
      if (hint) hint.textContent = "✓ Hotspot added — name it in the ✍ Content tab, or keep clicking to add more.";
    });
    drawAuthorDots();
  }

  /* Minimal context so the production player engines can run inside preview. */
  function renderEngineCtx(body, task) {
    const feedback = body.parentElement ? body.parentElement.querySelector("#edPrevFeedback") : null;
    const btnRetry = document.getElementById("edPrevRetry");
    return {
      body, task,
      feedback: feedback || h("div"),
      btnNext: null,
      btnRetry: btnRetry,
      state: { results: [] }, idx: 0, drawDots: () => {}, goHash: () => {},
      tbId: session ? (session.savedTo || session.target && session.target.tbId || "") : "",
      edit: true,
    };
  }

  /* ---- media manager ---- */
  function mediaEditor(t) {
    const wrap = h("div");
    t.media = t.media || [];
    const list = h("div");
    const redraw = () => {
      list.innerHTML = "";
      t.media.forEach((m, i) => {
        const src = m.src || "";
        const isData = /^data:/.test(src);
        const shown = isData ? (src.length > 60 ? src.slice(0, 42) + "…" : src) : src;
        const item = h("div", { class: "ed-mediarow" }, [
          h("span", null, S.MEDIA_ICONS[m.type] || "🎬"),
          h("span", { class: "ed-mediapath", title: shown }, shown),
          input(m.caption || "", v => { m.caption = v; markDirty(); }, { placeholder: "caption (optional)", class: "ed-input" }),
          isData ? rowBtn("remove", () => { t.media.splice(i, 1); redraw(); markDirty(); }, "danger tiny")
                 : rowBtn("✕", () => { t.media.splice(i, 1); redraw(); markDirty(); }, "danger tiny"),
        ]);
        list.appendChild(item);
      });
    };
    redraw();
    wrap.appendChild(list);

    const picker = h("div", { class: "ed-inline" }, [
      select("image", [["image", "🖼 Image"], ["audio", "🎧 Audio"], ["video", "🎬 Video"]], v => { picker.dataset.type = v; }),
      (() => {
        const inp = h("input", { type: "file", accept: "image/*,audio/*,video/*", class: "ed-file" });
        inp.onchange = () => {
          const f = inp.files[0];
          if (!f) return;
          if (f.size > MAX_ASSET) { toast("File is larger than 12 MB — keep packs small enough to email.", "bad"); return; }
          const rd = new FileReader();
          rd.onload = () => {
            const type = picker.dataset.type || (/^image\//.test(f.type) ? "image" : /^audio\//.test(f.type) ? "audio" : "video");
            const clean = f.name.replace(/[^\w.\-]+/g, "_");
            const rel = "assets/" + clean;
            if (session) session.assets[rel] = String(rd.result);
            t.media.push({ type, src: rel, caption: "" });
            redraw(); markDirty();
            toast("Media added — it travels with the exported pack", "ok");
          };
          rd.readAsDataURL(f);
          inp.value = "";
        };
        return inp;
      })(),
    ]);
    wrap.appendChild(picker);
    wrap.appendChild(h("div", { class: "ed-help" },
      "Uploaded files are stored inside the textbook folder (assets/) when you save, and embedded into the exported pack, so whoever receives the pack sees the same pictures and hears the same audio."));
    return wrap;
  }

  /* ============================================================ exports */
  window.renderCreate = renderCreate;
  window.renderImport = renderImport;
  window.renderEditor = renderEditor;
})();
