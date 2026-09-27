// Rewrites the JavaScript entries of SHELL_FILES in sw.js from what is actually
// under js/, so adding, moving or deleting a module never leaves the offline
// cache list out of date (tests/boot.test.js fails if it is).
//
//   node tools/update-sw-list.js            check only (exit 1 if sw.js is out of date)
//   node tools/update-sw-list.js --write    fix sw.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WRITE = process.argv.includes("--write");

function moduleFiles(dir = "js") {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const p = dir + "/" + e.name;
    if (e.isDirectory()) return e.name === "vendor" ? [] : moduleFiles(p);
    return e.name.endsWith(".js") ? [p] : [];
  });
}

const swPath = path.join(ROOT, "sw.js");
const raw = fs.readFileSync(swPath, "utf8");
const crlf = raw.includes("\r\n");
const lines = raw.split("\r\n").join("\n").split("\n");
const isModuleEntry = (l) => /^\s*"\.\/js\/(?!vendor\/)[^"]+\.js",\s*$/.test(l);
const kept = lines.filter((l) => !isModuleEntry(l));
const at = kept.findIndex((l) => /"\.\/js\/vendor\//.test(l));
if (at < 0) throw new Error("couldn't find where the vendor entries start in sw.js");
kept.splice(at, 0, ...moduleFiles().sort().map((f) => `  "./${f}",`));
const next = kept.join("\n");
if (next === lines.join("\n")) {
  console.log("sw.js cache list is up to date");
} else if (WRITE) {
  fs.writeFileSync(swPath, crlf ? next.split("\n").join("\r\n") : next);
  console.log("sw.js cache list updated");
} else {
  console.log("sw.js cache list is out of date (run with --write)");
  process.exit(1);
}
