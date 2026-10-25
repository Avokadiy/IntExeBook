/* regression: the "New version?" header button is hidden while up to date and
   only appears when a newer release exists in the hub. */
"use strict";
const fs = require("fs");
const assert = require("assert");

const src = fs.readFileSync(__dirname + "/../web/update.js", "utf8");

// 1. no always-visible button anymore
assert(!/addMenuButton/.test(src), "addMenuButton (always-visible button) must be gone");
assert(/function setUpdateBtnVisible\(show\)/.test(src), "setUpdateBtnVisible missing");

// 2. check(): shows the button only on the newer-release branch, hides otherwise
const start = src.indexOf("async function check(force)");
assert(start >= 0, "check() not found");
const body = src.slice(start, src.indexOf("function boot()", start));
const trueIdx = body.indexOf("setUpdateBtnVisible(true)");
const falseIdx = body.indexOf("setUpdateBtnVisible(false)");
assert(trueIdx >= 0, "check does not show the button on a new release");
assert(falseIdx >= 0, "check does not hide the button when up to date");
assert(trueIdx < falseIdx, "show/hide branches in wrong order");
// the show call must sit inside the "newer version" branch (before showDialog)
assert(body.indexOf("showDialog") > trueIdx, "button shown outside the new-release branch");

// 3. periodic refresh toggles visibility too
assert(/setUpdateBtnVisible\(newer\)/.test(src), "refresh does not toggle the button");

// 4. boot() no longer creates the button unconditionally
const boot = src.slice(src.indexOf("function boot()"));
assert(!/addMenuButton/.test(boot), "boot still adds the button unconditionally");

console.log("ok 1 - update button hidden while up to date, shown only for a new release");
console.log("all update-button regression checks passed");
