// Runs tests/phone-smoke.page.js inside the app on a USB-connected Android
// phone (debug build) and prints a pass/fail report.
//
//   node tests/phone-smoke.js          quick UI check (non-destructive)
//   node tests/phone-smoke.js --deep   also plays a song and rebuilds the whole library
//                                      (wipes and re-reads the saved library)
//
// Needs: adb on PATH or in the default Android SDK location, USB debugging on,
// and the debug APK installed (android-app: npm run sync, gradlew assembleDebug,
// adb install -r). Launches the app, attaches over the WebView DevTools socket,
// and removes the port forward when done. Non-destructive.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PACKAGE = "com.nikko.musicplayerpwa";
const PORT = 9222;

function findAdb() {
  const local = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
  return local && fs.existsSync(local) ? local : "adb";
}
const ADB = findAdb();
const adb = (...args) => execFileSync(ADB, args, { encoding: "utf8" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const devices = adb("devices").split("\n").slice(1).filter((l) => /\tdevice$/.test(l.trim()));
  if (!devices.length) throw new Error("No phone found over USB (check the cable and USB debugging).");
  adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  adb("shell", "am", "force-stop", PACKAGE);
  adb("shell", "monkey", "-p", PACKAGE, "-c", "android.intent.category.LAUNCHER", "1");
  await sleep(15000);
  const socket = /webview_devtools_remote_(\d+)/.exec(adb("shell", "cat /proc/net/unix"));
  if (!socket) throw new Error("App's WebView isn't debuggable (use the debug APK).");
  adb("forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${socket[1]}`);
  try {
    const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const page = pages.find((p) => p.type === "page") || pages[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const reply = await new Promise((resolve) => {
      ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) resolve(d.result); };
      const deep = process.argv.includes("--deep") ? "window.__smokeDeep = true;\n" : "";
      const expression = deep + fs.readFileSync(path.join(__dirname, "phone-smoke.page.js"), "utf8");
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    ws.close();
    if (reply.exceptionDetails) throw new Error("Smoke script crashed: " + JSON.stringify(reply.exceptionDetails.exception && reply.exceptionDetails.exception.description));
    const report = JSON.parse(reply.result.value);
    for (const [name, ok, detail] of report.results) console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
    console.log(`\n${report.passed} passed, ${report.failed} failed`);
    process.exitCode = report.failed ? 1 : 0;
  } finally {
    try { adb("forward", "--remove", `tcp:${PORT}`); } catch {}
  }
}
main().catch((e) => { console.error(e.message); process.exit(2); });
