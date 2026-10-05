// Pull down from the top of the folder list re-reads the library (ui/pullToRefresh.js).
// Checked in the real app (jsdom, fake OneDrive): a real pull refreshes the saved
// library, a tiny movement or a pull that starts mid-list does not.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
process.chdir(ROOT);
if (!fs.existsSync(path.join(ROOT, "tools", "node_modules", "jsdom"))) {
  console.log("SKIP pull-refresh test (run: cd tools && npm install)");
  process.exit(0);
}
const { startApp } = require("./helpers/ui-env");

let bad = 0;
const check = (name, ok, detail = "") => {
  if (!ok) bad++;
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
};

(async () => {
  const app = await startApp();
  const { $, sleep, window } = app;
  const list = $("#file-list");
  const scannedAt = () => JSON.parse(window.localStorage.getItem("libraryIndexCache")).scannedAt;
  const touch = (type, y) => {
    const ev = new window.Event(type, { bubbles: true });
    ev.touches = type === "touchend" || type === "touchcancel" ? [] : [{ clientY: y }];
    list.dispatchEvent(ev);
  };

  // a tiny movement: nothing happens
  const before = scannedAt();
  await sleep(5);
  touch("touchstart", 100);
  touch("touchmove", 104);
  touch("touchend", 104);
  await sleep(100);
  check("a tiny movement does not refresh", scannedAt() === before);

  // a real pull from the top: the library is re-read
  await sleep(5);
  touch("touchstart", 100);
  touch("touchmove", 260);
  touch("touchend", 260);
  await sleep(400);
  check("a real pull from the top re-reads the library", scannedAt() > before, `scannedAt ${before} -> ${scannedAt()}`);
  check("the strip is closed again afterwards", $("#pull-refresh").style.height === "0px");

  // a pull that starts after the list has been scrolled down: nothing happens
  list.scrollTop = 300;
  const before2 = scannedAt();
  await sleep(5);
  touch("touchstart", 100);
  touch("touchmove", 260);
  touch("touchend", 260);
  await sleep(100);
  check("a pull that starts mid-list does not refresh", scannedAt() === before2);
  list.scrollTop = 0;

  await app.stop();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log("FAIL pull-refresh test crashed: " + (e && e.stack || e)); process.exit(1); });
