// Talks to the app running on a USB-connected Android phone (debug build):
// launches it, attaches to its WebView over the Chrome DevTools Protocol, and
// can press the real hardware keys. Used by tests/phone-smoke.js.
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

async function connect() {
  const devices = adb("devices").split("\n").slice(1).filter((l) => /\tdevice$/.test(l.trim()));
  if (!devices.length) throw new Error("No phone found over USB (check the cable and USB debugging).");
  adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  adb("shell", "am", "force-stop", PACKAGE);
  adb("shell", "monkey", "-p", PACKAGE, "-c", "android.intent.category.LAUNCHER", "1");
  await sleep(15000);
  const socket = /webview_devtools_remote_(\d+)/.exec(adb("shell", "cat /proc/net/unix"));
  if (!socket) throw new Error("App's WebView isn't debuggable (use the debug APK).");
  adb("forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${socket[1]}`);
  const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = pages.find((p) => p.type === "page") || pages[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let nextId = 0;
  const waiting = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (waiting.has(d.id)) { waiting.get(d.id)(d.result); waiting.delete(d.id); }
  };

  // Evaluates JS in the page (awaiting promises) and returns its value.
  async function evaluate(expression) {
    const id = ++nextId;
    const reply = await new Promise((resolve) => {
      waiting.set(id, resolve);
      ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    if (reply.exceptionDetails) throw new Error("Page script threw: " + JSON.stringify(reply.exceptionDetails.exception && reply.exceptionDetails.exception.description));
    return reply.result.value;
  }

  return {
    evaluate,
    sleep,
    back: async () => { adb("shell", "input", "keyevent", "KEYCODE_BACK"); await sleep(500); },
    close() {
      try { ws.close(); } catch {}
      try { adb("forward", "--remove", `tcp:${PORT}`); } catch {}
    },
  };
}

module.exports = { connect, sleep };
