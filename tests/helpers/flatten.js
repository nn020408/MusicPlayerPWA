// The app's modules use import/export, which the vm sandboxes in these tests
// can't run. flat() turns a module's source back into a plain script by
// dropping import lines and the `export` keyword. That is exactly equivalent
// here because every top-level name in the app is unique, so all modules can
// share one sandbox where the tests can also reach internal state.
// (tests/modules.test.js checks the real import/export wiring separately.)
const fs = require("fs");
const path = require("path");

function flat(file) {
  return fs
    .readFileSync(file, "utf8")
    .replace(/^import\s[^;]*?from\s+["'][^"']+["'];?[^\n]*\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];?[^\n]*\r?\n/gm, "")
    .replace(/^export\s+/gm, "");
}

// Every module reachable from `entry`, dependencies first: the same order the
// browser evaluates them in.
function moduleOrder(entry) {
  const order = [];
  const seen = new Set();
  (function visit(file) {
    if (seen.has(file)) return;
    seen.add(file);
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/^import\s(?:[^;]*?from\s+)?["'](\.[^"']+)["']/gm)) visit(path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1])));
    order.push(file);
  })(entry);
  return order;
}

// Every .js file under js/ except the vendored plugins.
function allModuleFiles(dir = "js") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = dir + "/" + e.name;
    if (e.isDirectory()) return e.name === "vendor" ? [] : allModuleFiles(p);
    return e.name.endsWith(".js") ? [p] : [];
  });
}

module.exports = { flat, moduleOrder, allModuleFiles };
