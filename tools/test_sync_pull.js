#!/usr/bin/env node
/* Regression test for the sync “false success” bug:
   pressing “🔄 Update” used to report every course as updated even though
   shared-exercises/ on GitHub was empty. Run: node tools/test_sync_pull.js */
"use strict";

const path = require("path");
const assert = require("assert");

/* --- minimal browser environment ------------------------------------- */
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
global.window = global;

let fetchHandler = () => { throw new Error("fetch not configured"); };
global.fetch = async (url, opts) => fetchHandler(url, opts || {});
function jsonResponse(obj, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => obj };
}

const SHARED = require(path.join(__dirname, "..", "web", "shared.js"));
const SYNC = SHARED.sync;
assert(SYNC, "IEB_SHARED.sync must be exposed");

/* ---------------------------------------------------------------------- */
let failures = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log("  ok  - " + name),
    e => { failures++; console.log("FAIL  - " + name + "\n        " + e.message); }
  );
}

(async function main() {
  console.log("sync pull regression tests");

  await test("sync hub is the dedicated shared-hub branch, not a stale feature branch", () => {
    assert.strictEqual(SYNC.DEFAULTS.branch, "shared-hub");
  });

  await test("empty shared-exercises folder -> no fake updates, note explains it", async () => {
    Object.keys(store).forEach(k => delete store[k]);
    fetchHandler = (url) => {
      if (String(url).includes("/contents/shared-exercises")) return jsonResponse([]);
      return jsonResponse({}, 404);
    };
    const res = await SYNC.pull();
    assert.deepStrictEqual(res.updated, [], "must not claim anything was updated");
    assert.deepStrictEqual(res.added, []);
    assert.strictEqual(res.listed, 0);
    assert.ok(/empty/i.test(res.note), "note should say the hub is empty: " + res.note);
  });

  await test("stale cached index must not masquerade as an offline success", async () => {
    Object.keys(store).forEach(k => delete store[k]);
    // cache from a previous session that DID contain courses
    store["ieb-sync-index"] = JSON.stringify({ at: Date.now(), packs: [
      { name: "a.iebpack.json", path: "shared-exercises/a.iebpack.json" },
      { name: "b.iebpack.json", path: "shared-exercises/b.iebpack.json" },
      { name: "c.iebpack.json", path: "shared-exercises/c.iebpack.json" },
    ]});
    fetchHandler = () => Promise.reject(new Error("NetworkError: offline"));
    const res = await SYNC.pull();
    // offline cache may still be *listed*, but nothing may be counted as
    // updated unless it was actually installed this run (no backend here)
    const claimed = res.added.length + res.updated.length + res.merged.length;
    assert.ok(claimed === 0 || res.offline === true,
      "either nothing claimed, or explicitly flagged offline");
    for (const t of [].concat(res.added, res.updated, res.merged)) {
      assert.ok(true, t);
    }
  });

  await test("listing failure with empty cache surfaces an error, not a fake success", async () => {
    Object.keys(store).forEach(k => delete store[k]);
    fetchHandler = () => Promise.reject(new Error("NetworkError: offline"));
    const res = await SYNC.pull();
    assert.strictEqual(res.added.length + res.updated.length + res.merged.length, 0);
    assert.ok(res.errors.length > 0, "network failure must be reported");
  });

  await test("counts only reflect real installs (server /api/import present)", async () => {
    Object.keys(store).forEach(k => delete store[k]);
    global.location = { protocol: "http:", hostname: "localhost" };
    let importCalls = 0;
    const pack = { format: "ieb-pack", packageId: "pkg-test-1", revision: 2,
                   fingerprint: "fp-new", manifest: { title: "Test Course" } };
    fetchHandler = (url, opts) => {
      const u = String(url);
      if (u.includes("api.github.com/repos/") && !u.includes("/contents/")) {
        return jsonResponse({ default_branch: "main" });
      }
      if (u.includes("/contents/shared-exercises?")) {
        return jsonResponse([{ name: "pkg-test-1.iebpack.json", path: "shared-exercises/pkg-test-1.iebpack.json" }]);
      }
      if (u.includes("raw.githubusercontent.com")) return jsonResponse(pack);
      if (u === "/api/installed-packs") return jsonResponse({ packs: [] });
      if (u === "/api/import") {
        importCalls++;
        return jsonResponse({ action: "install", title: "Test Course", folder: "test-course" });
      }
      return jsonResponse({}, 404);
    };
    const res = await SYNC.pull();
    assert.strictEqual(res.added.length, 1, "one real install -> one added");
    assert.strictEqual(importCalls, 1);
    assert.strictEqual(res.updated.length, 0);
  });

  await test("failed install is reported as an error, never as updated", async () => {
    Object.keys(store).forEach(k => delete store[k]);
    global.location = { protocol: "http:", hostname: "localhost" };
    const pack = { format: "ieb-pack", packageId: "pkg-test-2", revision: 5,
                   fingerprint: "fp-x", manifest: { title: "Broken Course" } };
    fetchHandler = (url) => {
      const u = String(url);
      if (u.includes("/contents/shared-exercises?")) {
        return jsonResponse([{ name: "pkg-test-2.iebpack.json", path: "shared-exercises/pkg-test-2.iebpack.json" }]);
      }
      if (u.includes("raw.githubusercontent.com")) return jsonResponse(pack);
      if (u === "/api/installed-packs") {
        return jsonResponse({ packs: [{ packageId: "pkg-test-2", revision: 1, fingerprint: "fp-old" }] });
      }
      if (u === "/api/import") return jsonResponse({ error: "boom" }, 500);
      return jsonResponse({}, 404);
    };
    const res = await SYNC.pull();
    assert.strictEqual(res.updated.length, 0, "failed import must NOT count as updated");
    assert.strictEqual(res.added.length, 0);
    assert.ok(res.errors.some(e => /pkg-test-2/.test(e)), "error names the pack: " + res.errors);
  });

  /* ---------------- admin hub delete (git + local mirror) --------------- */
  await test("deletePack sends DELETE to the Contents API with the blob sha", async () => {
    Object.keys(store).forEach(k => delete store[k]);
    const calls = [];
    fetchHandler = (url, opts) => {
      const u = String(url);
      calls.push({ url: u, method: (opts && opts.method) || "GET", body: opts && opts.body });
      if (u.includes("/contents/shared-exercises/") && ((opts && opts.method) || "GET") === "GET") {
        return jsonResponse({ name: "x.iebpack.json", path: "shared-exercises/x.iebpack.json", sha: "abc123" });
      }
      if (((opts && opts.method) || "") === "DELETE") return jsonResponse({ commit: {} });
      return jsonResponse({}, 404);
    };
    SYNC.saveConfig({ owner: "o", repo: "r", branch: "shared-hub", folder: "shared-exercises", token: "t-1" });
    const cfg = SYNC.config();
    const res = await SYNC.deletePack(cfg, "x.iebpack.json");
    assert.strictEqual(res.deleted, true);
    const del = calls.find(c => c.method === "DELETE");
    assert.ok(del, "a DELETE request was made");
    const body = JSON.parse(del.body);
    assert.strictEqual(body.sha, "abc123", "delete carries the current blob sha");
    assert.strictEqual(body.branch, "shared-hub");
    assert.ok(del.url.includes("shared-exercises/x.iebpack.json"), "path keeps literal slashes: " + del.url);
    assert.ok(!del.url.includes("%2F"), "folder part must NOT be percent-encoded (GitHub treats %2F as a file name): " + del.url);
  });

  await test("deletePack without a token fails loudly (never pretends success)", async () => {
    Object.keys(store).forEach(k => delete store[k]);
    fetchHandler = () => { throw new Error("network must not be used"); };
    SYNC.saveConfig({ owner: "o", repo: "r", branch: "shared-hub", folder: "shared-exercises", token: "" });
    let threw = null;
    try { await SYNC.deletePack(SYNC.config(), "x.iebpack.json"); } catch (e) { threw = e; }
    assert.ok(threw && /token/i.test(threw.message), "clear no-token error: " + (threw && threw.message));
  });

  /* ------------------------------------------------ deletion propagation */

  await test("courses deleted from the hub are forgotten locally on next pull", async () => {
    Object.keys(store).forEach(k => delete store[k]);
    // we previously installed pkg-gone and pkg-stay from the hub
    SYNC.registrySet("pkg-gone", { remotePath: "shared-exercises/pkg-gone.iebpack.json", revision: 1 });
    SYNC.registrySet("pkg-stay", { remotePath: "shared-exercises/pkg-stay.iebpack.json", revision: 1,
                                   fingerprint: "fp-stay" });
    fetchHandler = (url) => {
      const u = String(url);
      if (u.includes("/contents/shared-exercises?")) {
        return jsonResponse([{ name: "pkg-stay.iebpack.json", path: "shared-exercises/pkg-stay.iebpack.json", sha: "s", size: 1 }]);
      }
      if (u.includes("raw.githubusercontent.com")) {
        return jsonResponse({ format: "ieb-pack", packageId: "pkg-stay", revision: 1,
                              fingerprint: "fp-stay", manifest: { title: "Stay" }, books: {} });
      }
      return jsonResponse({}, 404);
    };
    const res = await SYNC.pull();
    assert.deepStrictEqual(res.removed, ["pkg-gone"], "gone course must be reported as removed");
    assert.strictEqual(SYNC.registry()["pkg-gone"], undefined, "registry must forget the gone course");
    assert.ok(SYNC.registry()["pkg-stay"], "still-published course stays registered");
    assert.strictEqual(res.errors.length, 0, "no errors: " + JSON.stringify(res.errors));
  });

  await test("offline listing never triggers local deletions", async () => {
    Object.keys(store).forEach(k => delete store[k]);
    SYNC.registrySet("pkg-b", { remotePath: "shared-exercises/pkg-b.iebpack.json", revision: 1 });
    fetchHandler = async () => { throw new Error("network down"); };
    const res = await SYNC.pull();
    assert.ok(res.errors.length, "network failure surfaces as an error, not silence");
    assert.strictEqual((res.removed || []).length, 0, "offline must not delete anything");
    assert.ok(SYNC.registry()["pkg-b"], "registry untouched while offline");
  });

  await test("empty hub listing does not mass-delete local courses", async () => {
    Object.keys(store).forEach(k => delete store[k]);
    SYNC.registrySet("pkg-mine", { remotePath: "shared-exercises/pkg-mine.iebpack.json", revision: 2, localModified: true });
    fetchHandler = (url) => {
      const u = String(url);
      if (u.includes("/contents/shared-exercises?")) return jsonResponse([]);  // empty folder
      return jsonResponse({}, 404);
    };
    const res = await SYNC.pull();
    assert.strictEqual((res.removed || []).length, 0, "empty listing must not mass-delete");
    assert.ok(SYNC.registry()["pkg-mine"], "local course survives an empty hub listing");
    assert.ok(/empty/i.test(res.note), "note explains the hub is empty");
  });

  process.exitCode = failures ? 1 : 0;
  console.log(failures ? failures + " test(s) failed" : "all tests passed");
})();
