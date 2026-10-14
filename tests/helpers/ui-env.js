// Runs the REAL app (index.html, css/style.css, every js module) inside jsdom,
// with a fake OneDrive, fake Microsoft sign-in and a fake audio element, so UI
// behaviour can be tested from Node with no phone or browser. jsdom has no
// layout engine, so position/size checks are meaningless here (the phone test
// covers those); clicks, overlays, classes, text and stored data are all real.
//
//   const app = await startApp();        // signed in, library saved, top folder open
//   app.$("#search-btn").click();
//   await app.dom.window.document...     // or use the globals: document, localStorage, ...
//   await app.stop();
//
// Must be started once per Node process (the modules keep state).
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");

// ---- a small fake OneDrive: id -> { name, folders: [ids], songs: [[name, artist|null]] }
const TREE = {
  root: { name: "Music", folders: ["rock", "pop", "salsa"], songs: [["Ballade Pour Adeline.mp3", "Richard Clayderman"], ["Untagged Song.mp3", null]] },
  rock: { name: "Rock", folders: ["live"], songs: [["Sad But True.mp3", "Metallica"], ["Enter Sandman.mp3", "Metallica"], ["Wonderwall.mp3", "Oasis"]] },
  live: { name: "Live", folders: [], songs: [["Yesterday (Live).mp3", "The Beatles"]] },
  pop: { name: "Pop", folders: [], songs: [["Hips Don't Lie.mp3", "Shakira"], ["Who Knew.mp3", "P!nk"], ["Baila Conmigo.mp3", "Selena Gomez & Rauw Alejandro"]] },
  salsa: { name: "Salsa", folders: [], songs: [["Pedro Navaja.mp3", "Ruben Blades"], ["La Vida Es Un Carnaval.mp3", "Celia Cruz"]] },
};
const id = (folder, name) => `${folder}/${name}`;
// song ids the fake OneDrive has deleted: asking for their download link gives 404
const GONE = new Set();
// song ids a DELETE request should fail for (simulates e.g. a permission
// error) — anything not in here succeeds. DELETED records every id actually
// sent a (successful) DELETE, in order, so a test can assert on it.
const FAIL_DELETE = new Set();
const DELETED = [];
// song ids whose full-file fetch (player.js's next-track blob prefetch)
// reports a Content-Length bigger than what it actually delivers — simulates
// a connection dropping mid-download, which fetch() can resolve from as if
// nothing went wrong.
const TRUNCATE_PREFETCH = new Set();

function graphResponse(url) {
  const m = /\/me\/drive\/(?:root|items\/([^/?]+))(?:\/children)?/.exec(url);
  if (/\/thumbnails/.test(url)) return { value: [] };
  if (m && /\/children/.test(url)) {
    const folderId = m[1] || "root";
    const f = TREE[folderId];
    if (!f) return { value: [] };
    return {
      value: [
        ...f.folders.map((fid) => ({ id: fid, name: TREE[fid].name, folder: { childCount: 1 } })),
        ...f.songs.filter(([name]) => !DELETED.includes(id(folderId, name))).map(([name]) => ({ id: id(folderId, name), name, file: { mimeType: "audio/mpeg" }, "@microsoft.graph.downloadUrl": "https://files.test/" + encodeURIComponent(id(folderId, name)) })),
      ],
    };
  }
  // Captures everything up to a "?" (not just up to the first "/") — song
  // ids in this fixture are "folderId/filename", so stopping at the first
  // "/" silently collapsed every single-item lookup down to just the
  // folder id, losing which song it was actually for.
  const item = /\/me\/drive\/items\/([^?]+)/.exec(url);
  if (item) return { id: item[1], "@microsoft.graph.downloadUrl": "https://files.test/" + encodeURIComponent(item[1]) };
  return {};
}

// The saved library cache the app would have written after a scan.
function savedLibrary() {
  const tracks = [];
  const folderPaths = { root: "" };
  const walk = (fid, p) => {
    const f = TREE[fid];
    f.songs.forEach(([name, artist]) => {
      const t = { id: id(fid, name), name, folderId: fid, audio: artist ? { artist } : null, _searchText: (name.replace(/\.[^/.]+$/, "") + " " + (artist || "")).toLowerCase(), indexed: true };
      tracks.push(t);
    });
    f.folders.forEach((c) => { folderPaths[c] = p ? p + "/" + TREE[c].name : TREE[c].name; walk(c, folderPaths[c]); });
  };
  walk("root", "");
  return { rootId: "root", tracks, folderPaths, scannedAt: Date.now(), version: 7 };
}

function fakeAudio() {
  return class FakeAudio {
    constructor() {
      this.listeners = {};
      this.paused = true;
      this.currentTime = 0;
      this.duration = 200;
      this.volume = 1;
      this.src = "";
      this.style = {};
    }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    removeEventListener() {}
    emit(type) { (this.listeners[type] || []).forEach((f) => f({ type })); }
    play() { this.paused = false; setTimeout(() => { this.emit("play"); this.emit("playing"); }, 0); return Promise.resolve(); }
    pause() { this.paused = true; setTimeout(() => this.emit("pause"), 0); }
    load() {}
    canPlayType() { return "probably"; }
    setAttribute() {}
    removeAttribute() {}
  };
}

// options.returning (default true): a returning user (folder chosen, welcome guide seen, library
// scanned). false = a brand-new install, which starts with the welcome guide.
async function startApp({ returning = true } = {}) {
  const { JSDOM, VirtualConsole } = require(path.join(ROOT, "tools", "node_modules", "jsdom"));
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8").replace(/<script[\s\S]*?<\/script>/g, ""); // jsdom doesn't run ES modules: the test imports app.js itself
  const dom = new JSDOM(html, { url: "https://localhost/", pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const { window } = dom;
  const style = window.document.createElement("style");
  style.textContent = fs.readFileSync(path.join(ROOT, "css", "style.css"), "utf8");
  window.document.head.appendChild(style);

  if (returning) {
    window.localStorage.setItem("defaultFolderPath", JSON.stringify([{ id: "root", name: "Music" }]));
    window.localStorage.setItem("introSeenV1", "1");
    window.localStorage.setItem("libraryIndexCache", JSON.stringify(savedLibrary()));
  }

  const define = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  for (const k of ["window", "document", "localStorage", "sessionStorage", "history", "location", "MutationObserver", "Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "TouchEvent", "PointerEvent", "HTMLElement", "Node", "FileReader", "getComputedStyle", "DOMParser", "matchMedia", "requestAnimationFrame", "cancelAnimationFrame", "DOMException"]) {
    if (window[k] !== undefined) define(k, typeof window[k] === "function" && !/^[A-Z]/.test(k) ? window[k].bind(window) : window[k]);
  }
  define("navigator", { userAgent: window.navigator.userAgent, language: "en-US", languages: ["en-US"], platform: "test", maxTouchPoints: 0, onLine: true, clipboard: { writeText: async () => {} } });
  define("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.matchMedia = globalThis.matchMedia;
  const Audio = fakeAudio();
  define("Audio", Audio);
  window.Audio = Audio;
  define("MediaMetadata", function MediaMetadata() {});
  // Node's own global URL (jsdom's isn't used here — "URL" isn't in the
  // window-property copy list above) has no Blob URL registry at all, so
  // player.js's URL.createObjectURL()/revokeObjectURL() calls (next-track
  // and artwork blob prefetching) would otherwise throw and get silently
  // swallowed, masking whatever uses them from ever being exercised here.
  class FakeURL extends URL {}
  let blobUrlCounter = 0;
  FakeURL.createObjectURL = () => `blob:test://${++blobUrlCounter}`;
  FakeURL.revokeObjectURL = () => {};
  define("URL", FakeURL);
  window.URL = FakeURL;
  // reading real tags always "fails" here, so the app falls back to the file names
  define("jsmediatags", { read: (url, cb) => cb.onError({ type: "test" }), Reader: class { setTagsToRead() { return this; } read(cb) { cb.onError({ type: "test" }); } } });
  define("confirm", () => true);
  define("prompt", () => null);
  define("alert", () => {});
  window.confirm = globalThis.confirm;
  const account = { homeAccountId: "test", username: "test@example.com" };
  define("msal", {
    PublicClientApplication: function () {
      return { initialize: async () => {}, handleRedirectPromise: async () => null, getAllAccounts: () => [account], getActiveAccount: () => account, setActiveAccount() {}, acquireTokenSilent: async () => ({ accessToken: "test-token" }), loginRedirect: async () => {}, logoutRedirect: async () => {} };
    },
  });
  const requests = [];
  define("fetch", async (url, options) => {
    requests.push(String(url));
    const u = String(url);
    const itemPath = u.split("/me/drive/items/")[1];
    const itemId = itemPath ? decodeURIComponent(itemPath.split("?")[0]) : null;
    if (options && options.method === "DELETE") {
      if (itemId && FAIL_DELETE.has(itemId)) return { ok: false, status: 403, json: async () => ({}), text: async () => "" };
      if (itemId) DELETED.push(itemId);
      return { ok: true, status: 204, json: async () => ({}), text: async () => "" };
    }
    if (itemId && GONE.has(itemId)) return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
    if (u.startsWith("https://files.test/")) {
      const fileId = decodeURIComponent(u.slice("https://files.test/".length));
      const realBytes = 1000; // arbitrary fake body — only its size matters to anything that checks
      const reportedLength = TRUNCATE_PREFETCH.has(fileId) ? realBytes * 2 : realBytes;
      return {
        ok: true, status: 206,
        headers: { get: (h) => (String(h).toLowerCase() === "content-length" ? String(reportedLength) : null) },
        body: null, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0),
        blob: async () => new window.Blob([new Uint8Array(realBytes)]),
      };
    }
    return { ok: true, status: 200, json: async () => graphResponse(u), text: async () => "" };
  });
  process.on("unhandledRejection", () => {});

  await import(pathToFileURL(path.join(ROOT, "js", "main.js")).href);
  // init() is async (sign-in check, then the main view); give it a moment
  await new Promise((r) => setTimeout(r, 300));
  const doc = window.document;
  return {
    dom,
    window,
    requests,
    $: (sel) => doc.querySelector(sel),
    $$: (sel) => [...doc.querySelectorAll(sel)],
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    stop: async () => window.close(),
  };
}

module.exports = { startApp, savedLibrary, TREE, GONE, FAIL_DELETE, DELETED, TRUNCATE_PREFETCH };
