// The real app in a simulated browser (see helpers/ui-env.js): the same in-page
// UI checks the phone test runs, plus the Android back-button scenarios, with no
// phone needed. Needs jsdom (cd tools && npm install); skipped without it.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
process.chdir(ROOT);
if (!fs.existsSync(path.join(ROOT, "tools", "node_modules", "jsdom"))) {
  console.log("SKIP ui test (run: cd tools && npm install)");
  process.exit(0);
}
const { startApp } = require("./helpers/ui-env");
const backScenarios = require("./phone-back.scenarios");

(async () => {
  let failed = 0;
  const report = (name, ok, detail) => {
    if (!ok) failed++;
    console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
  };
  const app = await startApp();
  globalThis.__smokeQuery = "metallica";
  const page = JSON.parse(await (0, eval)(fs.readFileSync(path.join(__dirname, "phone-smoke.page.js"), "utf8")));
  for (const [name, ok, detail] of page.results) report("ui/" + name, ok, detail);

  // "Press back" in the browser build is a popstate event (the app arms a history guard)
  const phone = {
    evaluate: async (expr) => (0, eval)(expr),
    sleep: app.sleep,
    back: async () => { app.window.dispatchEvent(new app.window.PopStateEvent("popstate")); await app.sleep(50); },
  };
  await backScenarios(phone, (name, ok, detail) => report("ui/" + name, ok, detail));
  await app.stop();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log("FAIL ui test crashed: " + (e && e.stack || e)); process.exit(1); });
