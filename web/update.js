/* IntExeBook — app update checker.
 *
 * The app itself is versioned by the file  app_version.json  kept in the ROOT
 * of the shared-hub branch:
 *
 *   { "version": "1.2.0",
 *     "date": "2026-11-01",
 *     "changelog": ["...", "..."],
 *     "download": { "zip": "https://github.com/OWNER/REPO/archive/refs/heads/shared-hub.zip" } }
 *
 * To ship a new release: bump "version" (and add changelog lines) on the
 * shared-hub branch and push. Every teacher's copy polls that file over the
 * GitHub raw API; when the remote version differs from the local bundled one,
 * a dialog offers to download the new build. No server-side infrastructure,
 * no Electron auto-updater required — works with the .command / python launch.
 */
(function () {
  "use strict";

  var POLL_MS = 6 * 60 * 60 * 1000;          /* re-check at most every 6 h */
  var DISMISS_HOURS = 12;                    /* snooze for half a day */
  var LS_SEEN = "ieb-update-seen";           /* version the user dismissed */
  var LS_AT = "ieb-update-checked-at";

  function cfg() {
    var S = window.IEB_SHARED || {};
    var d = S.SYNC_DEFAULTS || { owner: "Avokadiy", repo: "IntExeBook", branch: "shared-hub" };
    return { owner: d.owner, repo: d.repo, branch: d.branch };
  }

  function manifestUrl(c) {
    /* NOTE: raw.githubusercontent.com caches per-URL and ignores unknown query
       params like ?nocache — a plain fetch can keep serving a stale manifest
       for minutes after a push. cache:"reload" (used in fetchManifest) forces
       the browser to revalidate against origin. */
    return "https://raw.githubusercontent.com/" + c.owner + "/" + c.repo +
      "/" + c.branch + "/app_version.json?nocache=" + Date.now();
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
    /* cache:"reload" — raw.githubusercontent.com may serve a stale copy of the
       manifest for up to ~5 min after a push (?nocache is ignored there), so
       always revalidate against origin when checking for app updates. */
    var res = await fetch(manifestUrl(c), { cache: "reload" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    var j = await res.json();
    if (!j || !j.version) throw new Error("bad manifest");
    return j;
  }

  /* ------------------------------------------------------------- dialog */
  function showDialog(m, localVersion) {
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
      ' <span style="opacity:.6">(you have v' + esc(localVersion || "?") + ')</span></div>' +
      '<div style="max-height:240px;overflow:auto;border-left:3px solid var(--accent,#4a6cf7);' +
      'padding:2px 14px;margin-bottom:18px"><b>What\'s new</b><ul style="margin:8px 0 0 0">' +
      (items || '<li>No changelog provided.</li>') + '</ul></div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">' +
      '<button id="iebUpLater" class="btn" type="button" style="padding:8px 14px">Remind me later</button>' +
      '<button id="iebUpDl" class="btn btn-teacher" type="button" style="padding:8px 14px">⬇ Download v' + esc(m.version) + '</button>' +
      '</div></div>';
    document.body.appendChild(mask);

    var later = mask.querySelector("#iebUpLater");
    later.onclick = function () {
      try {
        localStorage.setItem(LS_SEEN, m.version);
        localStorage.setItem(LS_AT, String(Date.now()));
      } catch (e) {}
      mask.remove();
    };
    mask.querySelector("#iebUpDl").onclick = function () {
      window.open(dl, "_blank");
      var note = document.createElement("div");
      note.style.cssText = "margin-top:12px;font-size:13px;opacity:.8";
      note.textContent = "Download started. Unpack the archive and run the app as usual — " +
        "your courses and settings are stored separately and survive the update.";
      mask.querySelector("div > div:last-child").before(note);
      later.textContent = "Close";
    };
    /* click outside does NOT dismiss — an update dialog should be explicit */
  }

  async function check(force) {
    var local = (window.IEB_APP_VERSION || "1.0.0");
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
    b.title = "Check for a new version of the app";
    b.textContent = "⬆ Updates";
    b.addEventListener("click", function () {
      b.disabled = true; b.textContent = "⏳ …";
      check(true).catch(function () {}).then(function () {
        b.disabled = false; b.textContent = "⬆ Updates";
      });
      setTimeout(function () { b.disabled = false; b.textContent = "⬆ Updates"; }, 8000);
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
    window.IEB_UPDATE = { check: check, compareVersions: cmpVer, fetchManifest: fetchManifest };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else { boot(); }
  }
})();
