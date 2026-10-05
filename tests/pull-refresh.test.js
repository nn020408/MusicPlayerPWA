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
const { startApp, TREE } = require("./helpers/ui-env");

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

  // ---- scoped: inside Rock, a pull refreshes Rock (and beneath it), not the rest of the library
  const titles = () => JSON.parse(window.localStorage.getItem("libraryIndexCache")).tracks.map((t) => t.name);
  const waitForScan = async (since) => { for (let i = 0; i < 50 && scannedAt() === since; i++) await sleep(50); };
  const openRock = async () => {
    const rockRow = [...document.querySelectorAll("#file-list .folder-row")].find((r) => r.textContent.includes("Rock"));
    rockRow.click();
    await sleep(300);
  };
  await sleep(50);
  await openRock();
  check("inside Rock: the breadcrumb says so", /Rock/.test($("#breadcrumb").textContent));

  // the fake OneDrive changes: a rock song is deleted and another is added, and a
  // pop song is added that is OUTSIDE the folder on screen
  const beforeTitles = titles();
  TREE.rock.songs = TREE.rock.songs.filter(([n]) => n !== "Wonderwall.mp3");
  TREE.rock.songs.push(["Fresh Rock.mp3", "Metallica"]);
  TREE.pop.songs.push(["Outside Pop.mp3", "Someone"]);
  const scopedBefore = scannedAt();
  touch("touchstart", 100);
  touch("touchmove", 260);
  touch("touchend", 260);
  await waitForScan(scopedBefore);
  const afterTitles = titles();
  check("a pull inside Rock removes the song deleted in that folder", !afterTitles.includes("Wonderwall.mp3"));
  check("a pull inside Rock adds the song added in that folder", afterTitles.includes("Fresh Rock.mp3"));
  check("a pull inside Rock leaves the rest of the library alone", !afterTitles.includes("Outside Pop.mp3"), `${beforeTitles.length} -> ${afterTitles.length} songs`);
  check("the library still has the other folders' songs", afterTitles.includes("Ballade Pour Adeline.mp3") && afterTitles.includes("Hips Don't Lie.mp3"));

  // back at the top of the library: a pull re-reads everything, including the pop song
  await sleep(50);
  document.querySelector(".crumb").click();
  await sleep(300);
  const topBefore = scannedAt();
  touch("touchstart", 100);
  touch("touchmove", 260);
  touch("touchend", 260);
  await waitForScan(topBefore);
  check("a pull at the top of the library refreshes everything", titles().includes("Outside Pop.mp3"));

  await app.stop();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log("FAIL pull-refresh test crashed: " + (e && e.stack || e)); process.exit(1); });
