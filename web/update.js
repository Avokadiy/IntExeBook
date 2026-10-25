/* IntExeBook — app update checker + one-click self-update.
 *
 * The app itself is versioned by the file  app_version.json  kept in the ROOT
 * of the shared-hub branch:
 *
 *   { "version": "1.2.0",
 *     "date": "2026-11-01",
 *     "changelog": ["...", "..."],
 *     "files": ["app_version.json", "web/index.html", "web/app.js", ...],
 *     "download": { "zip": "https://github.com/OWNER/REPO/archive/refs/heads/shared-hub.zip" } }
 *
 * To ship a new release: bump "version" (add changelog lines, and list the
 * changed app files under "files") on the shared-hub branch and push. Every
 * teacher's copy polls that manifest; when the remote version is newer a
 * dialog appears with the changelog and an "Update now" button which:
 *   1. downloads every listed app file from GitHub (SHA-pinned raw URLs),
 *   2. POSTs them to the local server (/api/app-update, founder key),
 *   3. the server writes them into the app folder (with a .app-backup/ copy)
 *   4. the page reloads — the app is updated without re-downloading anything
 *      manually. Courses/settings live in textbooks/ and localStorage and are
 *      never touched.
 * A plain ZIP download remains as fallback for file:// mode or if the server
 * refuses (no key / no backend).
 */
(function () {
  "use strict";

  var POLL_MS = 6 * 60 * 60 * 1000;          /* re-check at most every 6 h */
  var LS_SEEN = "ieb-update-seen";           /* version the user dismissed */
  var LS_AT = "ieb-update-checked-at";
  var LS_KEY = "ieb-admin-key";              /* founder key remembered here */

  /* App files the self-updater may install when the release manifest does
     not carry an explicit "files" list. Keep in sync with the repo layout. */
  var DEFAULT_APP_FILES = [
    "app_version.json",
    "web/index.html", "web/style.css", "web/shared.js", "web/app.js",
    "web/authoring.js", "web/admin.js", "web/textbooks-index.js",
    "server/app.py", "server/loader.py"
  ];

  function cfg() {
    var S = window.IEB_SHARED || {};
    var d = S.SYNC_DEFAULTS || { owner: "Avokadiy", repo: "IntExeBook", branch: "shared-hub" };
    return { owner: d.owner, repo: d.repo, branch: d.branch };
  }

  function manifestUrl(c, sha) {
    /* raw.githubusercontent.com caches branch refs for minutes and ignores
       unknown query params like ?nocache — that made freshly pushed releases
       invisible ("you are on the latest 1.0.0"). We resolve the branch HEAD
       via the API (cached ~60 s) and fetch the manifest from a SHA-pinned
       raw URL, which is immutable and always fresh. */
    if (sha) {
      return "https://raw.githubusercontent.com/" + c.owner + "/" + c.repo +
        "/" + sha + "/app_version.json";
    }
    return "https://raw.githubusercontent.com/" + c.owner + "/" + c.repo +
      "/" + c.branch + "/app_version.json?nocache=" + Date.now();
  }

  async function branchHeadSha(c) {
    var api = "https://api.github.com/repos/" + c.owner + "/" + c.repo +
      "/commits/" + encodeURIComponent(c.branch) + "?per_page=1&_=" + Date.now();
    var res = await fetch(api, { cache: "reload", headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    var j = await res.json();
    return j && j.sha ? j.sha : null;
  }

  function cmpVer(a, b) {
    var pa = String(a || "0").split("."), pb = String(b || "0").split(".");
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var x = parseInt(pa[i] || "0", 10), y = parseInt(pb[i] || "0", 10);
      if (x !== y) return x - y;
    }
    return 0;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m];
    });
  }

  async function fetchManifest() {
    var c = cfg();
    var sha = null;
    try { sha = await branchHeadSha(c); } catch (e) { /* offline / rate limit */ }
    var res = await fetch(manifestUrl(c, sha), { cache: "reload" });
    if (!res.ok && sha) res = await fetch(manifestUrl(c, null), { cache: "reload" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    var j = await res.json();
    if (!j || !j.version) throw new Error("bad manifest");
    j._sha = sha;
    return j;
  }

  /* ------------------------------------------------------- local version */
  var LOCAL_VERSION = null;                  /* cached from the server */

  async function localVersion() {
    if (LOCAL_VERSION) return LOCAL_VERSION;
    /* When served by the bundled python server, ask it — it reads the file
       from disk, so right after a self-update (before any restart) it will
       already report the NEW version. file:// falls back to the global. */
    try {
      if (location.protocol === "http:" || location.protocol === "https:") {
        var r = await fetch("/api/app-version?_=" + Date.now(), { cache: "reload" });
        if (r.ok) {
          var j = await r.json();
          if (j && j.version) { LOCAL_VERSION = j.version; return j.version; }
        }
      }
    } catch (e) { /* ignore */ }
    return window.IEB_APP_VERSION || "1.0.0";
  }

  /* --------------------------------------------------------- self-update */
  function hasServer() {
    return (location.protocol === "http:" || location.protocol === "https:") &&
      /^(localhost|127\.|\[::1\])/.test(location.hostname);
  }

  async function fetchHubFile(c, sha, path) {
    var url = sha
      ? "https://raw.githubusercontent.com/" + c.owner + "/" + c.repo + "/" + sha + "/" + path
      : "https://raw.githubusercontent.com/" + c.owner + "/" + c.repo + "/" + c.branch + "/" + path;
    var res = await fetch(url, { cache: "reload" });
    if (!res.ok) throw new Error(path + ": HTTP " + res.status);
    return await res.text();
  }

  /* Download every app file of the new release and hand them to the local
     server, which validates paths and writes them into the app folder. */
  async function performSelfUpdate(m, setStatus) {
    var c = cfg();
    var list = Array.isArray(m.files) && m.files.length ? m.files : DEFAULT_APP_FILES;
    /* never let a broken manifest wipe the updater itself */
    list = list.filter(function (p) {
      return p && !/^\.\./.test(p) && p.indexOf("\x00") < 0 &&
        p !== ".gitignore" && p.indexOf(".git/") !== 0;
    });
    var files = [];
    for (var i = 0; i < list.length; i++) {
      setStatus("Downloading " + list[i] + " (" + (i + 1) + "/" + list.length + ")…");
      files.push({ path: list[i], content: await fetchHubFile(c, m._sha, list[i]) });
    }
    var key = "";
    try { key = localStorage.getItem(LS_KEY) || ""; } catch (e) {}
    setStatus("Installing " + files.length + " files…");
    var res = await fetch("/api/app-update?key=" + encodeURIComponent(key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: files })
    });
    var out = null;
    try { out = await res.json(); } catch (e) {}
    if (!res.ok || !out || !out.ok) {
      var msg = (out && out.error) || ("HTTP " + res.status);
      var err = new Error(msg);
      err.adminKeyMissing = /admin key/i.test(msg);
      throw err;
    }
    return out;
  }

  /* ------------------------------------------------------------- dialog */
  function showDialog(m, localV) {
    if (document.getElementById("ieb-update-modal")) return;
    var seen = null;
    try { seen = localStorage.getItem(LS_SEEN); } catch (e) {}
    if (seen === m.version) return;                 /* dismissed for this ver */

    var dl = (m.download && (m.download.zip || m.download.url)) ||
      "https://github.com/" + cfg().owner + "/" + cfg().repo +
      "/archive/refs/heads/" + cfg().branch + ".zip";

    var items = (Array.isArray(m.changelog) ? m.changelog : (m.changelog ? [String(m.changelog)] : []))
      .map(function (line) { return "<li>" + esc(line) + "</li>"; }).join("");

    var mask = document.createElement("div");
    mask.id = "ieb-update-modal";
    mask.style.cssText = "position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.45);" +
      "display:flex;align-items:center;justify-content:center;padding:16px";
    mask.innerHTML =
      '<div style="background:var(--card,#fff);color:var(--ink,#222);max-width:520px;width:100%;' +
      'border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.35);padding:22px 24px;font-family:inherit">' +
      '<div style="font-size:20px;font-weight:700;margin-bottom:4px">🆕 New version available</div>' +
      '<div style="opacity:.75;margin-bottom:14px">IntExeBook <b>v' + esc(m.version) + '</b>' +
      (m.date ? ' · ' + esc(m.date) : '') +
      ' <span style="opacity:.6">(you have v' + esc(localV || "?") + ')</span></div>' +
      '<div style="max-height:240px;overflow:auto;border-left:3px solid var(--accent,#4a6cf7);' +
      'padding:2px 14px;margin-bottom:14px"><b>What\'s new</b><ul style="margin:8px 0 0 0">' +
      (items || '<li>No changelog provided.</li>') + '</ul></div>' +
      '<div id="iebUpStatus" style="min-height:18px;font-size:13px;margin-bottom:10px;opacity:.85"></div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">' +
      '<button id="iebUpLater" class="btn" type="button" style="padding:8px 14px">Remind me later</button>' +
      '<button id="iebUpDl" class="btn" type="button" style="padding:8px 14px" title="Download the full archive instead">⬇ ZIP</button>' +
      '<button id="iebUpNow" class="btn btn-teacher" type="button" style="padding:8px 14px">⚡ Update now</button>' +
      '</div></div>';
    document.body.appendChild(mask);

    var statusEl = mask.querySelector("#iebUpStatus");
    var setStatus = function (t) { statusEl.textContent = t || ""; };
    var later = mask.querySelector("#iebUpLater");
    later.onclick = function () {
      try {
        localStorage.setItem(LS_SEEN, m.version);
        localStorage.setItem(LS_AT, String(Date.now()));
      } catch (e) {}
      mask.remove();
    };
    mask.querySelector("#iebUpDl").onclick = function () { window.open(dl, "_blank"); };

    var nowBtn = mask.querySelector("#iebUpNow");
    nowBtn.onclick = async function () {
      if (!hasServer()) {
        setStatus("⚠ One-click update needs the local python server (python server/app.py). " +
          "Use the ZIP button instead.");
        return;
      }
      nowBtn.disabled = true;
      try {
        var out = await performSelfUpdate(m, setStatus);
        setStatus("✅ Updated " + (out.written || []).length + " files. Reloading…");
        setTimeout(function () { location.reload(); }, 900);
      } catch (e) {
        nowBtn.disabled = false;
        if (e && e.adminKeyMissing) {
          var k = prompt("Founder / admin key required to install updates\n(IEB_ADMIN_KEY, default \"akkaki\"):");
          if (k) {
            try { localStorage.setItem(LS_KEY, k); } catch (err) {}
            nowBtn.click();
          }
          return;
        }
        setStatus("⚠ " + ((e && e.message) || "update failed") +
          " — you can still use the ZIP download.");
      }
    };
    /* click outside does NOT dismiss — an update dialog should be explicit */
  }

  async function check(force) {
    var local = await localVersion();
    if (!force) {
      var at = 0;
      try { at = parseInt(localStorage.getItem(LS_AT) || "0", 10); } catch (e) {}
      if (Date.now() - at < POLL_MS) return null;
    }
    var m;
    try {
      m = await fetchManifest();
    } catch (e) {
      /* offline / GitHub unreachable — stay silent, retry next session */
      return null;
    }
    try { localStorage.setItem(LS_AT, String(Date.now())); } catch (e) {}
    if (cmpVer(m.version, local) > 0) {
      LOCAL_VERSION = local;               /* keep pre-update value in dialog */
      showDialog(m, local);
      return m;
    }
    if (force) toastUpToDate(m);
    return null;
  }

  function toastUpToDate(m) {
    var el = document.getElementById("edToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "edToast"; el.className = "ed-toast";
      document.body.appendChild(el);
    }
    el.textContent = "✅ You are on the latest version (v" + m.version + ")";
    el.className = "ed-toast show ok";
    clearTimeout(el._h);
    el._h = setTimeout(function () { el.className = "ed-toast"; }, 5000);
  }

  /* --------------------------------------------------------- UI hooks */
  function addMenuButton() {
    var theme = document.getElementById("themeToggle");
    if (!theme || document.getElementById("updateBtn")) return;
    var b = document.createElement("button");
    b.id = "updateBtn";
    b.className = "theme-toggle btn-text";
    b.type = "button";
    b.title = "Check for a new app release (not course sync — that is the 🔄 Update button)";
    b.textContent = "🆕 App v1.3";
    b.addEventListener("click", function () {
      b.disabled = true; b.textContent = "⏳ …";
      check(true).catch(function () {}).then(function () {
        b.disabled = false; b.textContent = "🆕 App v1.3";
      });
      setTimeout(function () { b.disabled = false; b.textContent = "🆕 App v1.3"; }, 8000);
    });
    theme.parentNode.insertBefore(b, theme);
  }

  function boot() {
    addMenuButton();
    /* first check shortly after start, then periodically while open */
    setTimeout(function () { check(false); }, 2500);
    setInterval(function () { check(false); }, POLL_MS);
  }

  if (typeof window !== "undefined") {
    window.IEB_UPDATE = {
      check: check, compareVersions: cmpVer, fetchManifest: fetchManifest,
      selfUpdate: performSelfUpdate, localVersion: localVersion
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else { boot(); }
  }
})();
