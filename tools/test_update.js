/* Regression tests for the app self-update flow (web/update.js + server).
   Run:  node tools/test_update.js                                          */
"use strict";
const fs = require("fs"), path = require("path"), assert = require("assert");
const ROOT = path.join(__dirname, "..");

/* ---- minimal browser stubs ------------------------------------------- */
function makeEnv(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.localStorage);
  const ls = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  const el = () => ({ style: {}, querySelector: () => el(), appendChild(){},
                     addEventListener(){}, remove(){}, classList:{add(){},remove(){}},
                     setAttribute(){}, textContent: "", innerHTML: "", disabled: false,
                     querySelectorAll: () => [], parentNode: null });
  const document = {
    readyState: "complete", getElementById: () => null, createElement: el,
    body: { appendChild(){}, querySelector: () => el() },
    addEventListener(){}, querySelector: () => el(),
    querySelectorAll: () => []
  };
  return { ls, document, store };
}

function loadUpdater(env, opts) {
  opts = opts || {};
  const fetched = [];
  const win = {
    IEB_SHARED: { SYNC_DEFAULTS: { owner: "o", repo: "r", branch: "shared-hub" } },
    IEB_APP_VERSION: opts.localVersion,
    localStorage: env.ls, document: env.document,
    location: { protocol: "http:", hostname: "localhost", reload() {} },
    fetch: async (url, init) => {
      fetched.push({ url: String(url), init: init || {} });
      if (String(url).includes("api.github.com")) {
        return { ok: true, json: async () => ({ sha: "deadbeef" }) };
      }
      if (String(url).includes("/api/app-version")) {
        if (opts.serverVersion === undefined) return { ok: false, status: 404 };
        return { ok: true, json: async () => ({ version: opts.serverVersion }) };
      }
      if (String(url).includes("/api/app-update")) {
        opts.updateCalls = opts.updateCalls || [];
        opts.updateCalls.push({ url: String(url), body: init && init.body });
        return { ok: true, json: async () => ({ ok: true, written: ["a.js"] }) };
      }
      if (String(url).includes("raw.githubusercontent.com") &&
          String(url).endsWith("/app_version.json")) {
        if (!opts.manifest) return { ok: false, status: 404 };
        /* manifest fetch answers with json(); when selfUpdate re-downloads
           the same file as a release FILE it calls .text() — give it one. */
        return { ok: true, status: 200,
                 json: async () => opts.manifest,
                 text: async () => JSON.stringify(opts.manifest) };
      }
      /* any other raw hub file (web/x.js, server/app.py, …) */
      return { ok: true, status: 200, text: async () => "// file content",
               json: async () => ({}) };
    },
    setTimeout: () => 0, setInterval: () => 0, confirm: () => opts.confirm !== false,
    prompt: () => null, open: () => {}
  };
  win.window = win;
  const src = fs.readFileSync(path.join(ROOT, "web/update.js"), "utf8");
  new Function("window", "document", "localStorage", "location", "fetch",
    "setTimeout", "setInterval", "confirm", "prompt", "open", "navigator",
    src + "\n;return window.IEB_UPDATE;")(win, win.document, win.localStorage,
    win.location, win.fetch, win.setTimeout, win.setInterval, win.confirm,
    win.prompt, win.open, { onLine: true });
  return { api: win.IEB_UPDATE, fetched, win };
}

(async function main() {
  /* 1. hub manifest must NOT count as the installed version ------------- */
  {
    const env = makeEnv();
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, "app_version.json"), "utf8"));
    assert.ok(!m._installed, "the published manifest must not carry _installed");
    const u = loadUpdater(env, { localVersion: "1.3.0", manifest: m });
    const found = await u.api.check(true);
    assert.ok(found && found.version === m.version,
      "v" + m.version + " release must be offered to a v1.3 install");
    console.log("ok 1 - hub manifest is never treated as the local version");
  }

  /* 2. changelog grouped by version -> only the new release shown ------- */
  {
    const env = makeEnv();
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, "app_version.json"), "utf8"));
    const u = loadUpdater(env, { localVersion: "1.3.0", manifest: m });
    const clHtml = [];
    env.document.createElement = () => {
      const o = { style: {}, innerHTML: "", querySelector: () => ({ style: {}, onclick: null }),
                  appendChild(){}, remove(){}, classList:{add(){},remove(){}} };
      Object.defineProperty(o, "innerHTML", {
        set(v) { clHtml.push(String(v)); }, get() { return ""; } });
      return o;
    };
    await u.api.check(true);
    const html = clHtml.join("\n");
    assert.ok(html.includes("What&#39;s new in v") || html.includes("What's new in v"),
      "dialog must show a per-version header");
    assert.ok(html.includes("founder key"), "current release items must be listed");
    assert.ok(html.includes("Full changelog"), "older releases go under full changelog");
    assert.ok(!/Initial public release[\s\S]*What's new/.test(html),
      "old items must not sit in the What's-new block");
    console.log("ok 2 - changelog shows only the offered release (+ collapsible history)");
  }

  /* 3. self-update needs an explicit confirmation ----------------------- */
  {
    const env = makeEnv({ localStorage: { "ieb-admin-key": "akkaki" } });
    const m = { version: "9.9.9", files: ["web/x.js"] };
    const opts = { localVersion: "1.3.0", manifest: m };
    const u = loadUpdater(env, opts);
    m._sha = "deadbeef";   /* normally stamped by fetchManifest() */
    let threw = false;
    try { await u.api.selfUpdate(m, () => {}, false); }
    catch (e) { threw = /not confirmed/i.test(e.message); }
    assert.ok(threw, "unconfirmed update must be refused");
    assert.strictEqual((opts.updateCalls || []).length, 0,
      "refused update must not POST to the server");
    const out = await u.api.selfUpdate(m, () => {}, true);   /* confirmed -> performs POST */
    assert.ok(out && out.ok, "confirmed update reports success");
    const calls = opts.updateCalls || [];
    assert.strictEqual(calls.length, 1, "exactly one app-update POST");
    assert.ok(/[?&]key=$/.test(calls[0].url.replace(/^https?:\/\/[^/]+/, "")),
      "loopback update sends an empty founder key in the URL: " + calls[0].url);
    const body = JSON.parse(calls[0].body);
    const paths = body.files.map(f => f.path);
    assert.ok(paths.includes("web/x.js"), "manifest file list is downloaded");
    assert.ok(paths.includes("app_version.json"), "manifest itself is always updated");
    assert.strictEqual(env.store["ieb-admin-key"], "akkaki",
      "a loopback update must neither require nor overwrite the stored key");
    console.log("ok 3 - performSelfUpdate requires confirmation, no key stored");
  }

  /* 4. local version comes from the server when it reports one ---------- */
  {
    const env = makeEnv();
    const u = loadUpdater(env, { localVersion: "1.3.0", serverVersion: "1.4.0",
                                 manifest: { version: "1.4.0" } });
    const v = await u.api.localVersion();
    assert.strictEqual(v, "1.4.0", "installed version read from disk wins");
    const found = await u.api.check(true);
    assert.strictEqual(found, null, "already-installed release must not nag again");
    console.log("ok 4 - after installing, the same release is no longer offered");
  }

  /* 5. versions are normalised ("v1.3" == 1.3.0 for comparison) --------- */
  {
    const env = makeEnv();
    const u = loadUpdater(env, { localVersion: "v1.3", serverVersion: undefined,
                                 manifest: { version: "1.4.0" } });
    assert.strictEqual(await u.api.localVersion(), "1.3");
    assert.ok(u.api.compareVersions("1.4.0", "1.3") > 0);
    console.log("ok 5 - version strings normalised before comparing");
  }

  /* 6. updater refuses to overwrite the release manifest with a course -- */
  {
    const loaderSrc = fs.readFileSync(path.join(ROOT, "server/loader.py"), "utf8");
    assert.ok(/refusing to save a course over the release manifest/.test(loaderSrc),
      "save_hub_pack must guard app_version.json");
    assert.ok(/_require_update_auth/.test(fs.readFileSync(path.join(ROOT, "server/app.py"), "utf8")),
      "app-update endpoint uses the loopback auth guard");
    console.log("ok 6 - server-side guards present");
  }

  console.log("all update tests passed");
})().catch(e => { console.error("FAIL:", e && e.stack || e); process.exit(1); });
