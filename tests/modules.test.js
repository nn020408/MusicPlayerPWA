// The real ES-module wiring, not the flattened sandbox the other tests use:
//  1. static check: every name a module uses is either declared in it, imported
//     into it, or a known browser global; every import names something the target
//     module actually exports; no module imports itself in a cycle
//  2. load check: the whole app is imported as genuine ES modules under Node
//     against a fake browser, so a bad import/export fails at link time and any
//     top-level wiring error is thrown
// The static check needs acorn + eslint-scope (cd tools && npm install); without
// them it is skipped with a note and only the load check runs.
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { createEnv } = require("./helpers/env");

const ROOT = path.join(__dirname, "..");
process.chdir(ROOT);
let bad = 0;
const check = (name, ok, detail = "") => {
  if (!ok) bad++;
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  " + detail : ""));
};

const BROWSER_GLOBALS = new Set("window document console navigator localStorage sessionStorage location history fetch setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame Promise Map Set WeakMap WeakSet Array Object String Number Boolean Math JSON Date Error TypeError RangeError SyntaxError RegExp Symbol Uint8Array ArrayBuffer DataView URL URLSearchParams AbortController Blob FileReader TextDecoder TextEncoder Image Audio Event CustomEvent MutationObserver Intl isNaN isFinite parseInt parseFloat encodeURIComponent decodeURIComponent undefined NaN Infinity globalThis alert confirm prompt performance getComputedStyle matchMedia MediaMetadata jsmediatags msal btoa atob Notification crypto CSS HTMLElement DOMException structuredClone queueMicrotask innerWidth innerHeight".split(" "));

function moduleFiles() {
  return fs.readdirSync(path.join(ROOT, "js"), { withFileTypes: true }).flatMap((e) => (e.isFile() && e.name.endsWith(".js") ? ["js/" + e.name] : []));
}

function staticCheck() {
  let acorn, eslintScope;
  try {
    acorn = require(path.join(ROOT, "tools", "node_modules", "acorn"));
    eslintScope = require(path.join(ROOT, "tools", "node_modules", "eslint-scope"));
  } catch {
    console.log("SKIP static wiring check (run: cd tools && npm install)");
    return;
  }
  const files = moduleFiles();
  const parsed = new Map();
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    try {
      const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: "module", ranges: true, locations: true });
      parsed.set(f, { ast, sm: eslintScope.analyze(ast, { ecmaVersion: 2022, sourceType: "module" }) });
    } catch (e) {
      check("parses as an ES module: " + f, false, e.message);
    }
  }
  const exportsOf = new Map();
  for (const [f, { ast }] of parsed) {
    const names = new Set();
    for (const n of ast.body) {
      if (n.type !== "ExportNamedDeclaration") continue;
      if (n.declaration) {
        if (n.declaration.id) names.add(n.declaration.id.name);
        (n.declaration.declarations || []).forEach((d) => d.id.name && names.add(d.id.name));
      }
      (n.specifiers || []).forEach((s) => names.add(s.exported.name));
    }
    exportsOf.set(f, names);
  }
  let problems = [];
  for (const [f, { ast, sm }] of parsed) {
    const imported = new Set();
    for (const n of ast.body) {
      if (n.type !== "ImportDeclaration") continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), n.source.value));
      if (!exportsOf.has(target)) { problems.push(`${f}: imports from missing module ${n.source.value}`); continue; }
      for (const s of n.specifiers) {
        imported.add(s.local.name);
        if (!exportsOf.get(target).has(s.imported.name)) problems.push(`${f}: imports ${s.imported.name} but ${target} does not export it`);
      }
    }
    const seen = new Set();
    for (const scope of sm.scopes) for (const ref of scope.references) {
      if (ref.resolved) continue;
      const name = ref.identifier.name;
      if (BROWSER_GLOBALS.has(name) || seen.has(name)) continue;
      seen.add(name);
      problems.push(`${f}:${ref.identifier.loc.start.line} uses ${name}, which is not declared, imported or a known global`);
    }
    // an import that is never used is clutter (and usually a sign of a bad move)
    const used = new Set();
    for (const scope of sm.scopes) for (const ref of scope.references) if (ref.resolved) used.add(ref.resolved.name);
    for (const name of imported) if (!used.has(name)) problems.push(`${f}: imports ${name} but never uses it`);
  }
  check(`static wiring: ${files.length} modules, every import/export and name resolves`, problems.length === 0, problems.slice(0, 8).join("\n   "));
}

async function loadCheck() {
  const { ctx } = createEnv();
  for (const [k, v] of Object.entries(ctx)) {
    try {
      Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    } catch { /* read-only global (e.g. navigator on newer Node): the stub is skipped */ }
  }
  process.on("unhandledRejection", () => {}); // async init() against the fake browser may fail quietly
  try {
    await import(pathToFileURL(path.join(ROOT, "js", "app.js")).href);
    check("load: the whole app imports as ES modules and its top-level code runs", true);
  } catch (e) {
    check("load: the whole app imports as ES modules and its top-level code runs", false, e.message + "\n" + String(e.stack).split("\n").slice(1, 4).join("\n"));
  }
  await new Promise((r) => setTimeout(r, 200));
}

(async () => {
  staticCheck();
  await loadCheck();
  process.exit(bad ? 1 : 0);
})();
