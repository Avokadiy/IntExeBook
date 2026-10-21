/* ============================================================
   IntExeBook — founder / admin panel (route #/admin)

   Unlocked by the Konami code (↑↑↓↓←→←→BA, see web/app.js). What used to
   be a pure easter egg is now a real management console for the course
   hub: every published .iebpack.json inside shared-exercises/ can be

     * listed        GET    /api/admin/hub?key=<key>
     * opened in the visual editor and saved back in place
                     GET    /api/admin/hub/<file>?key=<key>
                     PATCH  /api/admin/hub/<file>?key=<key>
     * deleted       DELETE /api/admin/hub/<file>?key=<key>
     * created from scratch (publishes into shared-exercises/)
                     POST   /api/admin/hub?key=<key>

   The panel talks to the local server only (file:// mode shows a hint to
   start server/app.py). The admin key defaults to the founder key and can
   be overridden with the IEB_ADMIN_KEY environment variable.
   ============================================================ */
"use strict";

(function () {
  const S = window.IEB_SHARED;
  if (!S) { console.error("shared.js is missing"); return; }
  const A = window.IEB_APP || {};
  const app = A.app;
  const esc = A.esc;
  const API = A.API;
  const FILE_MODE = A.FILE_MODE;

  const LS_KEY = "ieb-admin-key";
  const DEFAULT_KEY = "akkaki";           // founder key — same as server default

  /* ------------------------------------------------ tiny DOM helpers */
  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else el.setAttribute(k, v);
    }
    (Array.isArray(children) ? children : children === undefined || children === null ? [] : [children])
      .forEach(c => el.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return el;
  }
  function btn(label, cls, onclick) {
    return h("button", { class: "btn " + (cls || "btn-ghost"), type: "button", onclick }, label);
  }
  function toast(msg, kind) {
    let t = document.getElementById("edToast");
    if (!t) { t = h("div", { id: "edToast", class: "ed-toast" }); document.body.appendChild(t); }
    t.textContent = msg;
    t.className = "ed-toast show" + (kind ? " " + kind : "");
    clearTimeout(t._h);
    t._h = setTimeout(() => { t.className = "ed-toast"; }, 4200);
  }

  /* ------------------------------------------------------ admin key */
  function adminKey() {
    try { return localStorage.getItem(LS_KEY) || ""; } catch (e) { return ""; }
  }
  function setAdminKey(k) {
    try { localStorage.setItem(LS_KEY, k || ""); } catch (e) { /* ignore */ }
  }
  function askKey(current) {
    const k = prompt("Founder / admin key:\n(default \"akkaki\", override with the IEB_ADMIN_KEY env var)",
                     current || "");
    if (k === null) return null;
    setAdminKey(k.trim());
    return k.trim();
  }

  async function api(method, url, body) {
    const sep = url.includes("?") ? "&" : "?";
    const res = await fetch(API(url + sep + "key=" + encodeURIComponent(adminKey())), {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) throw new Object.assign(new Error((data && data.error) || ("HTTP " + res.status)),
                                         { status: res.status });
    return data;
  }

  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n > 1048576) return (n / 1048576).toFixed(1) + " MB";
    if (n > 1024) return (n / 1024).toFixed(0) + " KB";
    return n + " B";
  }

  /* ================================================================ view */
  async function renderAdmin() {
    if (!A.renderCrumbs) return;
    A.renderCrumbs([{ label: "🏠 Textbooks", href: "#/" }, { label: "🛡 Admin panel" }]);
    app.innerHTML = "";

    if (FILE_MODE) {
      app.appendChild(h("div", { class: "error-box" },
        "The admin panel needs the local server. Start it with: python server/app.py"));
      return;
    }
    if (!adminKey()) {
      app.innerHTML = "";
      const inp = h("input", { class: "ed-input", type: "password", placeholder: "founder key", style: "min-width:260px" });
      const form = h("div", { style: "max-width:420px;margin:60px auto;text-align:center" }, [
        h("h2", null, "🛡 Founder area"),
        h("p", { style: "opacity:.7" }, "Konami unlocked the door — enter the admin key to manage the shared course hub."),
        inp,
        h("div", { style: "margin-top:14px" }, btn("Enter", "btn-primary", () => {
          const v = (inp.value || "").trim();
          if (!v) { toast("Key is empty", "bad"); return; }
          setAdminKey(v); renderAdmin();
        })),
      ]);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { setAdminKey((inp.value || "").trim()); renderAdmin(); } });
      app.appendChild(form);
      return;
    }

    let data, loadErr = null;
    try { data = await api("GET", "/api/admin/hub"); }
    catch (e) {
      loadErr = e;
      if (e.status === 403 || /admin key/i.test(e.message || "")) {
        const fresh = askKey(adminKey());
        if (fresh) { renderAdmin(); return; }
        setAdminKey("");
      }
    }

    const head = h("div", { style: "display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px" }, [
      h("h2", { style: "margin:0" }, "🛡 Course hub — admin"),
      h("span", { class: "ed-target-chip" }, "✨ founder mode"),
      h("span", { style: "opacity:.6;font-size:12px;flex:1" }, (data && data.dir) || ""),
      btn("⟳ Refresh", "btn-ghost", renderAdmin),
      btn("＋ New course", "btn-primary", newCourseFlow),
      btn("🔑 Change key", "btn-ghost", () => { if (askKey(adminKey()) !== null) renderAdmin(); }),
      btn("✖ Exit", "btn-ghost", () => { setAdminKey(""); location.hash = "#/"; }),
    ]);
    app.appendChild(head);

    if (loadErr) {
      app.appendChild(h("div", { class: "error-box" }, "Hub is not reachable: " + esc(loadErr.message || String(loadErr))));
      return;
    }
    const packs = (data && data.packs) || [];
    if (!packs.length) {
      app.appendChild(h("div", { class: "hero", style: "text-align:center;padding:40px" }, [
        h("div", { style: "font-size:40px" }, "📭"),
        h("p", null, "The hub folder shared-exercises/ has no published courses yet."),
        btn("Create the first one", "btn-primary", newCourseFlow),
      ]));
      return;
    }

    const list = h("div", { style: "display:flex;flex-direction:column;gap:10px" });
    packs.forEach(p => list.appendChild(packRow(p)));
    app.appendChild(list);
    app.appendChild(h("p", { style: "opacity:.55;font-size:12px;margin-top:16px" },
      "Editing keeps the packageId — teachers who installed the course receive an update on their next sync, not a duplicate."));
  }

  function packRow(p) {
    const meta = [
      p.level ? "📶 " + p.level : "",
      p.author ? "✍ " + p.author : "",
      (p.units || 0) + " unit(s)", (p.tasks || 0) + " task(s)",
      "rev " + p.revision, fmtBytes(p.bytes), p.updated ? "· " + p.updated : "",
    ].filter(Boolean).join(" · ");
    return h("div", { class: "card", style: "display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:14px 16px" }, [
      h("div", { style: "flex:1;min-width:220px" }, [
        h("strong", null, (p.slots && p.slots.length > 1 ? "📚 " : "📘 ") + (p.title || p.file)),
        h("div", { style: "font-size:12px;opacity:.65;margin-top:2px" }, meta),
        h("div", { style: "font-size:11px;opacity:.45;margin-top:2px;font-family:monospace" }, p.file),
      ]),
      btn("✏ Edit", "btn-ghost", () => editCourseFlow(p)),
      btn("⬇ Download", "btn-ghost", async () => {
        try {
          const pk = await api("GET", "/api/admin/hub/" + encodeURIComponent(p.file));
          downloadFile(p.file, JSON.stringify(pk, null, 2));
        } catch (e) { toast("Download failed: " + e.message, "bad"); }
      }),
      btn("🗑 Delete", "btn-ghost danger", async () => {
        if (!confirm("Delete “" + (p.title || p.file) + "” from the shared hub?\nTeachers who already installed it keep their local copy; new syncs will no longer offer this course.")) return;
        try {
          await api("DELETE", "/api/admin/hub/" + encodeURIComponent(p.file));
          toast("Deleted “" + (p.title || p.file) + "” from the hub", "ok");
          renderAdmin();
        } catch (e) { toast("Delete failed: " + e.message, "bad"); }
      }),
    ]);
  }

  function downloadFile(name, text) {
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* -------------------------------------------------- create / edit flows
     Both hand the finished .iebpack.json to the authoring editor (full
     visual editing lives in web/authoring.js). On save the editor calls
     the hooks below instead of its normal publish path.

     "New course" starts a blank standalone editing session directly —
     no intermediate #/create page needed.                       */
  function newCourseFlow() {
    const A2 = window.IEB_AUTHORING;
    if (!A2 || typeof A2.startSession !== "function") { toast("Authoring module is not loaded", "bad"); return; }
    const S2 = window.IEB_SHARED;
    window.IEB_ADMIN = window.IEB_ADMIN || {};
    window.IEB_ADMIN.hubPublish = hubPublishFromSession;
    window.IEB_ADMIN.hubMode = "new";
    A2.startSession({
      target: { mode: "standalone" },
      manifest: { id: "hub-course-" + Date.now().toString(36), title: "",
                  level: "", author: "", icon: "📘",
                  student: "Student's Book", workbook: null },
      slot: "student",
      book: { id: "book", units: [] },
      assets: {},
    });
    toast("Create the course, then press “📦 Publish & share” — it goes straight into the hub", "ok");
  }

  async function editCourseFlow(p) {
    if (typeof window.renderImport !== "function") { toast("Authoring module is not loaded", "bad"); return; }
    try {
      const pk = await api("GET", "/api/admin/hub/" + encodeURIComponent(p.file));
      window.IEB_ADMIN = window.IEB_ADMIN || {};
      window.IEB_ADMIN.hubPublish = hubPublishFromSession;
      window.IEB_ADMIN.hubMode = { file: p.file, packageId: pk.packageId || p.packageId, revision: pk.revision || p.revision };
      window.__iebAdminPack = pk;                 // consumed by the import page once
      location.hash = "#/import?admin=hub";
    } catch (e) { toast("Could not open the course: " + e.message, "bad"); }
  }

  /* Called by authoring.js (publishCourse in hub mode) with the finished
     pack. Writes it through the guarded admin endpoints: PATCH keeps the
     original passport so sync sees an UPDATE, POST publishes a new course. */
  async function hubPublishFromSession(pack) {
    const mode = window.IEB_ADMIN && window.IEB_ADMIN.hubMode;
    if (!pack || !pack.manifest || !pack.books) { toast("Nothing to publish — the course is empty", "bad"); return false; }
    try {
      if (mode && mode !== "new" && mode.file) {
        // preserve the original passport so sync sees an UPDATE, not a copy
        pack.packageId = mode.packageId || pack.packageId;
        pack.revision = Math.max(Number(mode.revision) || 1, Number(pack.revision) || 1);
        await api("PATCH", "/api/admin/hub/" + encodeURIComponent(mode.file), { pack });
        toast("Hub course updated ✔ (“" + ((pack.manifest || {}).title || mode.file) + "”)", "ok");
      } else {
        await api("POST", "/api/admin/hub", packToPublishPayload(pack));
        toast("Published to the hub ✔", "ok");
      }
      window.IEB_ADMIN.hubMode = null;
      location.hash = "#/admin";
      return true;
    } catch (e) { toast("Hub write failed: " + e.message, "bad"); return false; }
  }

  function packToPublishPayload(pack) {
    return { manifest: pack.manifest, books: pack.books, assets: pack.assets || {},
             packageId: pack.packageId, revision: pack.revision };
  }

  window.renderAdmin = renderAdmin;
})();
