/* ============================================================
   IntExeBook – Electron main process (desktop app)

   Starts the built-in Node server core and opens the UI in a
   native window.  No Python, no browser, no internet needed.
   ============================================================ */
"use strict";

const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

/* In a packaged build the program folder is read-only, so textbooks live in
   a normal user-writable folder (e.g. %APPDATA%/IntExeBook/textbooks on
   Windows).  On first start the demo textbooks are copied there from the
   installer resources.  When running from source we just use ./textbooks. */
function setupTextbooksDir() {
  const devDir = path.resolve(__dirname, "..", "textbooks");
  if (!app.isPackaged) {
    process.env.IEB_TEXTBOOKS = devDir;
    return;
  }
  const userDir = path.join(app.getPath("userData"), "textbooks");
  fs.mkdirSync(userDir, { recursive: true });
  const seed = path.join(process.resourcesPath, "textbooks-seed");
  if (fs.existsSync(seed)) {
    for (const entry of fs.readdirSync(seed)) {
      if (entry.startsWith(".")) continue;
      const dest = path.join(userDir, entry);
      if (!fs.existsSync(dest)) {
        fs.cpSync(path.join(seed, entry), dest, { recursive: true });
      }
    }
  }
  try { fs.writeFileSync(path.join(userDir, "_HOW-TO-ADD-TEXTBOOKS.txt"),
    "To add a textbook, copy its folder or a .zip archive into this folder and restart IntExeBook.\n" +
    "Folders starting with _ are ignored. See the _TEMPLATE folder for the file format.\n"); } catch (e) {}
  process.env.IEB_TEXTBOOKS = userDir;
}
setupTextbooksDir();

const core = require("./server-core");

let mainWindow = null;
let server = null;

async function createWindow() {
  server = await core.start(0); // random free port – never clashes
  const port = server.address().port;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#f5f7ff",
    title: "IntExeBook",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow().catch((err) => {
    dialog.showErrorBox("IntExeBook failed to start", String(err && err.message || err));
    app.quit();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (server) server.close();
  app.quit();
});
