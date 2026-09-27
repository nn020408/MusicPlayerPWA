// Runs the UI checks inside the app on a USB-connected Android phone (debug
// build) and prints a pass/fail report.
//
//   node tests/phone-smoke.js          in-page UI checks + real back-button presses
//                                      (non-destructive)
//   node tests/phone-smoke.js --deep   also plays a song and rebuilds the whole library
//                                      (wipes and re-reads the saved library)
//
// Needs: adb (PATH or the default Android SDK location), USB debugging on, and
// the debug APK installed (android-app: npm run sync, gradlew assembleDebug,
// adb install -r). Launches the app itself and removes the port forward after.

const fs = require("fs");
const path = require("path");
const { connect } = require("./helpers/phone");
const backScenarios = require("./phone-back.scenarios");

async function main() {
  const phone = await connect();
  let failed = 0;
  let passed = 0;
  const report = (name, ok, detail) => {
    ok ? passed++ : failed++;
    console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
  };
  try {
    const deep = process.argv.includes("--deep") ? "window.__smokeDeep = true;\n" : "";
    const page = JSON.parse(await phone.evaluate(deep + fs.readFileSync(path.join(__dirname, "phone-smoke.page.js"), "utf8")));
    for (const [name, ok, detail] of page.results) report(name, ok, detail);
    await backScenarios(phone, report);
  } finally {
    phone.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}
main().catch((e) => { console.error(e.message); process.exit(2); });
