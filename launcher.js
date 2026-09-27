/* ============================================================
   IntExeBook – zero-dependency launcher (plain Node.js)

   This file needs NOTHING installed: no npm packages, no Python.
   It reuses the same server core that powers the desktop app and
   opens the built-in UI in your default browser.

   Run:  node launcher.js            (port 8000, auto-opens browser)
         node launcher.js --port 8080 --no-browser
   ============================================================ */
"use strict";

const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = __dirname;
process.env.IEB_TEXTBOOKS = process.env.IEB_TEXTBOOKS || path.join(ROOT, "textbooks");
const core = require(path.join(ROOT, "desktop", "server-core.js"));

const argv = process.argv.slice(2);
function argVal(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}
let port = parseInt(argVal("--port") || process.env.PORT || "8000", 10);
const noBrowser = argv.includes("--no-browser");

function openInBrowser(url) {
  if (noBrowser) return;
  try {
    const platform = process.platform;
    let cmd, args;
    if (platform === "win32") { cmd = "cmd"; args = ["/c", "start", "", url]; }
    else if (platform === "darwin") { cmd = "open"; args = [url]; }
    else { cmd = "xdg-open"; args = [url]; }
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch (e) { /* never let the browser-opening step kill the server */ }
}

function listen(p, attemptsLeft) {
  const server = http.createServer(core.handle);
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && attemptsLeft > 0) {
      console.log("[intexebook] port " + p + " is busy, trying " + (p + 1) + "…");
      listen(p + 1, attemptsLeft - 1);
    } else {
      console.error("[intexebook] cannot start server:", err.message);
      process.exit(1);
    }
  });
  server.listen(p, "127.0.0.1", () => {
    const url = "http://localhost:" + p;
    console.log("============================================================");
    console.log("  IntExeBook is running:  " + url);
    console.log("  Textbooks folder:       " + core.TEXTBOOKS_DIR);
    console.log("  Drop textbook folders or .zip archives there.");
    console.log("  Press Ctrl+C to stop.");
    console.log("============================================================");
    openInBrowser(url);
  });
}

listen(port, 10);
