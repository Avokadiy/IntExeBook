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

  /* Changelog by version.  A release manifest may carry either a flat list
     ("changelog": ["a", "b"]) or an object keyed by version
     ("changelogVersions": { "1.4.0": ["..."], "1.3.0": ["..."] }).  The
     dialog always shows ONLY the changes of the release being offered —
     older versions are listed under a collapsible "full changelog". */
  function normalizeChangelog(m) {
    var byVer = mergeChangelogSources(m);
    if (Object.keys(byVer).length) {
      var vers = Object.keys(byVer).sort(cmpVer).reverse();   /* newest first */
      return {
        current: [].concat(byVer[m.version] || []),
        history: vers.filter(function (v) { return v !== m.version; })
                     .map(function (v) { return { version: v, items: [].concat(byVer[v] || []) }; })
      };
    }
    var flat = Array.isArray(m.changelog) ? m.changelog :
      (m.changelog ? [String(m.changelog)] : []);
    return { current: flat.slice(), history: [] };
  }

  /* The hub manifest is a *release* manifest; the locally installed copy of
     app_version.json carries only "version" (+ maybe "_installed"), so after
     an update /api/app-version cannot provide per-version entries.  Merge
     every known source and fall back to the remote release notes, so the
     dialog never shows an empty changelog. */
  var REMOTE_CHANGELOG = null;             /* last fetched changelogVersions */

  function mergeChangelogSources(m) {
    var srcs = [m.changelogVersions, m.changelogByVersion];
    try {
      var s = localStorage.getItem("ieb-last-release-manifest");
      if (s) { var p = JSON.parse(s); srcs.push(p.changelogVersions, p.changelogByVersion); }
    } catch (e) {}
    if (REMOTE_CHANGELOG) srcs.push(REMOTE_CHANGELOG);
    var merged = {};
    srcs.forEach(function (byVer) {
      if (!byVer || typeof byVer !== "object" || Array.isArray(byVer)) return;
      Object.keys(byVer).forEach(function (v) {
        var cur = merged[v] || [];
        [].concat(byVer[v] || []).forEach(function (item) {
          if (cur.indexOf(item) < 0) cur.push(item);
        });
        merged[v] = cur;
      });
    });
    return merged;
  }

  function renderChangelogHtml(cl) {
    var items = (cl.current && cl.current.length) ? cl.current : ["No changelog provided."];
    var li = items.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("");
    var out = "<b>What's new in v" + esc(cl._ver || "") + "</b><ul style=\"margin:8px 0 0 0\">" +
      li + "</ul>";
    if (cl.history.length) {
      out += "<details style=\"margin-top:10px\"><summary style=\"cursor:pointer;opacity:.75\">" +
        "Full changelog (older versions)</summary>";
      cl.history.forEach(function (h) {
        out += "<div style=\"margin-top:8px\"><b>v" + esc(h.version) + "</b><ul style=\"margin:4px 0 0 0\">" +
          h.items.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ul></div>";
      });
      out += "</details>";
    }
    return out;
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
    /* remember the release notes locally: after a self-update the installed
       app_version.json may be stripped of changelog data, but the dialog
       should still render the notes of the release being offered */
    REMOTE_CHANGELOG = j.changelogVersions || j.changelogByVersion || REMOTE_CHANGELOG;
    try { localStorage.setItem("ieb-last-release-manifest", JSON.stringify(j)); } catch (e) {}
    return j;
  }

    /* ------------------------------------------------------- local version */
  var LOCAL_VERSION = null;                  /* cached from the server */

  function normalizeVer(v) {
    /* "1.3" / "1.3.0" / "v1.3" -> comparable string; cmpVer pads parts */
    return String(v || "").replace(/^v/i, "").trim();
  }

  async function localVersion() {
    if (LOCAL_VERSION) return LOCAL_VERSION;
    /* When served by the bundled python server, ask it — it reads the
       installed copy of app_version.json from disk (marked "_installed" by
       the self-updater), so right after a self-update it already reports
       the NEW version.  The hub's own app_version.json is the *remote*
       release manifest and must never count as the local version — that
       used to silence the update dialog for everyone who pushed a release.
       file:// falls back to the global baked into index.html. */
    try {
      if (location.protocol === "http:" || location.protocol === "https:") {
        var r = await fetch("/api/app-version?_=" + Date.now(), { cache: "reload" });
        if (r.ok) {
          var j = await r.json();
          if (j && j.version) {
            LOCAL_VERSION = normalizeVer(j.version);
            return LOCAL_VERSION;
          }
        }
      }
    } catch (e) { /* ignore */ }
    return normalizeVer(window.IEB_APP_VERSION || "1.0.0");
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
     server, which validates paths and writes them into the app folder.
     `confirmed` must be true — the caller shows a yes/no dialog first; no
     founder key is asked from the teacher anymore (the updater authenticates
     itself against the localhost-only endpoint). */
  async function performSelfUpdate(m, setStatus, confirmed) {
    if (!confirmed) throw new Error("update was not confirmed");
    var c = cfg();
    var list = Array.isArray(m.files) && m.files.length ? m.files : DEFAULT_APP_FILES;
    /* never let a broken manifest wipe the updater itself */
    list = list.filter(function (p) {
      return p && !/^\.\./.test(p) && p.indexOf("\x00") < 0 &&
        p !== ".gitignore" && p.indexOf(".git/") !== 0;
    });
    if (list.indexOf("app_version.json") < 0) list.unshift("app_version.json");
    var files = [];
    for (var i = 0; i < list.length; i++) {
      setStatus("Downloading " + list[i] + " (" + (i + 1) + "/" + list.length + ")…");
      files.push({ path: list[i], content: await fetchHubFile(c, m._sha, list[i]) });
    }
    /* loopback installs are authenticated by the server itself (see
       _require_update_auth); a stored founder key is only needed for
       non-local servers, so keep it out of the URL in the normal case. */
    var key = "";
    try { if (!hasServer()) key = localStorage.getItem(LS_KEY) || ""; } catch (e) {}
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

    var cl = normalizeChangelog(m);
    cl._ver = m.version;

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
      '<div style="max-height:280px;overflow:auto;border-left:3px solid var(--accent,#4a6cf7);' +
      'padding:2px 14px;margin-bottom:14px">' + renderChangelogHtml(cl) + '</div>' +
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
      /* simple yes/no confirmation — no founder key, no password */
      if (!window.confirm(
          "Install IntExeBook v" + m.version + " now?\n\n" +
          "The app will download the new files and restart itself.\n" +
          "Your courses and settings are not touched, and the previous\n" +
          "version is kept as a backup you can roll back to.")) {
        setStatus("Update cancelled — nothing was changed.");
        return;
      }
      nowBtn.disabled = true;
      later.disabled = true;
      try {
        var out = await performSelfUpdate(m, setStatus, true);
        setStatus("✅ Updated " + (out.written || []).length + " files. Reloading…");
        setTimeout(function () { location.reload(); }, 900);
      } catch (e) {
        nowBtn.disabled = false;
        later.disabled = false;
        if (e && e.adminKeyMissing) {
          /* only reachable for non-loopback servers; keep the old escape hatch */
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
  /* The manual update-check button stays hidden while the app is up to date.
     It only appears when a newer release is available in the hub (and after
     an install it disappears again once the versions match). */
  function setUpdateBtnVisible(show) {
    var theme = document.getElementById("themeToggle");
    if (!theme) return;
    var b = document.getElementById("updateBtn");
    if (show && !b) {
      b = document.createElement("button");
      b.id = "updateBtn";
      b.className = "theme-toggle btn-text";
      b.type = "button";
      b.title = "A new app version is available — click to see the changelog and install it (course sync is the 🔄 Update button)";
      b.textContent = "🆕 New version!";
      b.addEventListener("click", function () {
        b.disabled = true; b.textContent = "⏳ Checking…";
        Promise.resolve(check(true)).catch(function () {})
          .then(function (m) {
            b.disabled = false;
            b.textContent = m ? "🆕 New version!" : "✅ Up to date";
            if (!m) setTimeout(function () { setUpdateBtnVisible(false); }, 3000);
          });
        setTimeout(function () {
          if (b.disabled) { b.disabled = false; b.textContent = "🆕 New version!"; }
        }, 8000);
      });
      theme.parentNode.insertBefore(b, theme);
    } else if (!show && b) {
      b.remove();
    }
  }

  async function refresh() {
    var local = await localVersion();
    var m = null;
    try { m = await fetchManifest(); } catch (e) { /* offline — keep current state */ }
    if (!m) return null;
    var newer = cmpVer(m.version, local) > 0;
    setUpdateBtnVisible(newer);
    return newer ? m : null;
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
      try { localStorage.removeItem(LS_SEEN); } catch (e) {}  /* fresh release: re-ask */
      setUpdateBtnVisible(true);           /* show the button only with a new release */
      showDialog(m, local);
      return m;
    }
    setUpdateBtnVisible(false);            /* up to date — hide the button */
    if (force) toastUpToDate(m);
    return null;
  }

  function boot() {
    /* first check shortly after start, then periodically while open */
    setTimeout(function () { check(false); }, 2500);
    setInterval(function () { refresh(); }, POLL_MS);
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
