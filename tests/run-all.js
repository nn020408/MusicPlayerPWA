// Runs every tests/*.test.js in its own process and prints a summary.
//   node tests/run-all.js
// (tests/phone-smoke.js is separate: it needs a phone over USB.)
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const files = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.js")).sort();
let failedFiles = 0;
let totalPass = 0;
let totalFail = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: "utf8", timeout: 120000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const pass = (out.match(/^PASS/gm) || []).length;
  const fail = (out.match(/^FAIL/gm) || []).length;
  totalPass += pass;
  totalFail += fail;
  const ok = r.status === 0 && fail === 0;
  if (!ok) {
    failedFiles++;
    console.log(out.split("\n").filter((l) => /^(FAIL|Error|.*Error:)/.test(l) || l.includes("at ")).slice(0, 12).join("\n"));
  }
  console.log(`${ok ? "ok  " : "FAIL"} ${f.padEnd(34)} ${pass} passed${fail ? ", " + fail + " failed" : ""}${r.status !== 0 && !fail ? " (exit " + r.status + ")" : ""}`);
}
console.log(`\n${files.length - failedFiles}/${files.length} files ok, ${totalPass} checks passed, ${totalFail} failed`);
process.exit(failedFiles ? 1 : 0);
