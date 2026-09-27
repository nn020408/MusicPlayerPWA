// tools/scan-artists.js (the PC program the scheduled task runs) loads the app's
// own tag reader from js/data/id3.js. That file is an ES module, so if it stops
// loading in the tool the task fails silently every 30 minutes. This builds a
// tiny music folder with known artists, runs the real tool on it, and checks the
// file it writes.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
let bad = 0;
const check = (name, ok, detail = "") => {
  if (!ok) bad++;
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
};

// a minimal MP3-like file: an ID3v2.3 tag with one TPE1 (artist) frame, then some audio bytes
function mp3WithArtist(artist) {
  const text = Buffer.concat([Buffer.from([0]), Buffer.from(artist, "latin1")]); // encoding 0 = ISO-8859-1
  const frame = Buffer.concat([Buffer.from("TPE1"), Buffer.from([0, 0, 0, text.length]), Buffer.from([0, 0]), text]);
  const size = frame.length; // fits in one synchsafe byte
  const header = Buffer.concat([Buffer.from("ID3"), Buffer.from([3, 0, 0]), Buffer.from([0, 0, 0, size])]);
  return Buffer.concat([header, frame, Buffer.alloc(64, 0xff)]);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nube-pc-tool-"));
try {
  fs.mkdirSync(path.join(dir, "Rock"));
  fs.mkdirSync(path.join(dir, "Pop"));
  fs.writeFileSync(path.join(dir, "Rock", "Sad But True.mp3"), mp3WithArtist("Metallica"));
  fs.writeFileSync(path.join(dir, "Pop", "Sad But True.mp3"), mp3WithArtist("Someone Else")); // same name, another folder
  fs.writeFileSync(path.join(dir, "Top Song.mp3"), mp3WithArtist("Selena Gomez & Rauw Alejandro"));
  fs.writeFileSync(path.join(dir, "notes.txt"), "not a song");

  const cache = path.join(dir, "..", path.basename(dir) + ".cache.json"); // not the real one in tools/
  const run = () => spawnSync(process.execPath, [path.join(ROOT, "tools", "scan-artists.js"), dir], { encoding: "utf8", cwd: path.join(ROOT, "tools"), env: { ...process.env, NUBE_ARTISTS_CACHE: cache } });
  const first = run();
  check("the PC tool runs", first.status === 0, (first.stderr || first.stdout).split("\n").slice(-3).join(" | "));
  const outFile = path.join(dir, "nubeplayer-artists.json");
  check("it writes nubeplayer-artists.json", fs.existsSync(outFile));
  if (fs.existsSync(outFile)) {
    const data = JSON.parse(fs.readFileSync(outFile, "utf8"));
    check("file format is version 2", data.version === 2);
    check("artists are read from the tags, keyed by folder path + name", data.files["Rock/Sad But True.mp3"] === "Metallica" && data.files["Pop/Sad But True.mp3"] === "Someone Else" && data.files["Top Song.mp3"] === "Selena Gomez & Rauw Alejandro", JSON.stringify(data.files));
    check("only songs are listed", Object.keys(data.files).length === 3);
    const before = fs.statSync(outFile).mtimeMs;
    const second = run();
    check("a second run leaves the file alone when nothing changed", second.status === 0 && fs.statSync(outFile).mtimeMs === before && /already up to date/i.test(second.stdout), second.stdout.trim().slice(-90));
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
  try { fs.rmSync(path.join(dir, "..", path.basename(dir) + ".cache.json")); } catch {}
}
process.exit(bad ? 1 : 0);
